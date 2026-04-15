import hashlib
import os
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Backup, Device
from app.services.fortigate_api import FortiGateAPI
from app.services.config_diff import compare_configs, highlight_changes

logger = logging.getLogger(__name__)


def _ensure_backup_dir() -> str:
    backup_dir = os.path.abspath(settings.BACKUP_DIR)
    os.makedirs(backup_dir, exist_ok=True)
    return backup_dir


def _config_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


async def create_backup(
    db: AsyncSession,
    device: Device,
    vdom_name: Optional[str] = None,
    backup_type: str = "manual",
    notes: Optional[str] = None,
) -> Backup:
    api = FortiGateAPI(
        host=device.ip_address,
        port=device.port,
        api_key=device.api_key,
    )

    config_content: Optional[str] = None

    if vdom_name:
        # Specific VDOM requested
        try:
            config_content = await api.backup_config(vdom=vdom_name, scope="vdom")
        except Exception as exc:
            logger.error("VDOM backup failed for %s/%s: %s", device.name, vdom_name, exc)
            raise RuntimeError(f"Backup failed for {device.name} VDOM {vdom_name}: {exc}")
    else:
        # Full config: try global first, fall back to root VDOM
        try:
            config_content = await api.backup_config(scope="global")
        except Exception as exc:
            logger.warning(
                "Global backup failed for %s (likely API token permission), "
                "falling back to root VDOM backup: %s", device.name, exc,
            )
            try:
                vdom_name = "root"
                config_content = await api.backup_config(vdom="root", scope="vdom")
            except Exception as exc2:
                logger.error("Fallback VDOM backup also failed for %s: %s", device.name, exc2)
                raise RuntimeError(
                    f"Backup failed for {device.name}: global scope returned 403 "
                    f"and root VDOM fallback also failed: {exc2}"
                )

    backup_dir = _ensure_backup_dir()
    device_dir = os.path.join(backup_dir, device.name.replace(" ", "_"))
    os.makedirs(device_dir, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    vdom_part = f"_{vdom_name}" if vdom_name else "_full"
    filename = f"{device.name}{vdom_part}_{timestamp}.conf"
    filepath = os.path.join(device_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(config_content)

    file_size = os.path.getsize(filepath)
    config_hash_value = _config_hash(config_content)

    backup = Backup(
        device_id=device.id,
        vdom_name=vdom_name,
        filename=filename,
        filepath=filepath,
        file_size=file_size,
        backup_type=backup_type,
        config_hash=config_hash_value,
        notes=notes,
    )
    db.add(backup)
    await db.flush()
    await db.refresh(backup)
    return backup


async def list_backups(
    db: AsyncSession,
    device_id: Optional[int] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Backup]:
    stmt = select(Backup).order_by(Backup.created_at.desc()).limit(limit).offset(offset)
    if device_id is not None:
        stmt = stmt.where(Backup.device_id == device_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_backup_by_id(db: AsyncSession, backup_id: int) -> Optional[Backup]:
    result = await db.execute(select(Backup).where(Backup.id == backup_id))
    return result.scalar_one_or_none()


async def get_backup_content(backup: Backup) -> str:
    if not os.path.exists(backup.filepath):
        raise FileNotFoundError(f"Backup file not found: {backup.filepath}")
    with open(backup.filepath, "r", encoding="utf-8") as f:
        return f.read()


async def compare_backups(db: AsyncSession, backup_id_1: int, backup_id_2: int) -> dict:
    backup1 = await get_backup_by_id(db, backup_id_1)
    backup2 = await get_backup_by_id(db, backup_id_2)
    if not backup1 or not backup2:
        raise ValueError("One or both backups not found")

    content1 = await get_backup_content(backup1)
    content2 = await get_backup_content(backup2)

    unified_diff = compare_configs(content1, content2)
    changes = highlight_changes(content1, content2)

    return {
        "backup_1": {
            "id": backup1.id,
            "filename": backup1.filename,
            "created_at": backup1.created_at.isoformat() if backup1.created_at else None,
            "config_hash": backup1.config_hash,
        },
        "backup_2": {
            "id": backup2.id,
            "filename": backup2.filename,
            "created_at": backup2.created_at.isoformat() if backup2.created_at else None,
            "config_hash": backup2.config_hash,
        },
        "identical": backup1.config_hash == backup2.config_hash,
        "unified_diff": unified_diff,
        "changes": changes,
    }


async def delete_backup(db: AsyncSession, backup_id: int) -> bool:
    backup = await get_backup_by_id(db, backup_id)
    if not backup:
        return False

    if os.path.exists(backup.filepath):
        try:
            os.remove(backup.filepath)
        except OSError as exc:
            logger.warning("Failed to delete backup file %s: %s", backup.filepath, exc)

    await db.delete(backup)
    await db.flush()
    return True


async def auto_backup_all_devices(db: AsyncSession) -> list[dict]:
    results = []
    stmt = select(Device).where(Device.status == "online")
    db_result = await db.execute(stmt)
    devices = list(db_result.scalars().all())

    for device in devices:
        try:
            backup = await create_backup(db, device, backup_type="auto", notes="Scheduled automatic backup")
            results.append({
                "device_id": device.id,
                "device_name": device.name,
                "success": True,
                "backup_id": backup.id,
                "filename": backup.filename,
            })
        except Exception as exc:
            logger.error("Auto-backup failed for %s: %s", device.name, exc)
            results.append({
                "device_id": device.id,
                "device_name": device.name,
                "success": False,
                "error": str(exc),
            })

    return results
