from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Device, Backup
from app.schemas import BackupCreate, BackupCompare
from app.services import backup_service

router = APIRouter(prefix="/api/backups", tags=["backups"])


# ---------------------------------------------------------------------------
# Fixed-path routes MUST come before parameterized /{id} routes
# ---------------------------------------------------------------------------

@router.get("")
async def list_backups(
    device_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    backups = await backup_service.list_backups(db, device_id=device_id, limit=limit, offset=offset)

    device_ids = list({b.device_id for b in backups})
    device_map: dict[int, str] = {}
    if device_ids:
        dev_result = await db.execute(select(Device).where(Device.id.in_(device_ids)))
        for d in dev_result.scalars().all():
            device_map[d.id] = d.name

    return [
        {
            "id": b.id,
            "device_id": b.device_id,
            "device_name": device_map.get(b.device_id, f"Device {b.device_id}"),
            "vdom_name": b.vdom_name,
            "filename": b.filename,
            "file_size": b.file_size,
            "backup_type": b.backup_type,
            "config_hash": b.config_hash,
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "notes": b.notes,
        }
        for b in backups
    ]


@router.post("/compare")
async def compare_backups(payload: BackupCompare, db: AsyncSession = Depends(get_db)):
    try:
        result = await backup_service.compare_backups(db, payload.backup_id_1, payload.backup_id_2)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return result


@router.post("/auto")
async def auto_backup_all(db: AsyncSession = Depends(get_db)):
    """Backup all online devices automatically."""
    results = await backup_service.auto_backup_all_devices(db)
    success_count = sum(1 for r in results if r["success"])
    return {
        "message": f"Auto-backup completed: {success_count}/{len(results)} successful",
        "total": len(results),
        "success": success_count,
        "failed": len(results) - success_count,
        "results": results,
    }


@router.post("/backup-all")
async def backup_all_devices(
    db: AsyncSession = Depends(get_db),
):
    """Backup ALL managed devices (online + offline attempted).

    Unlike /auto which only targets online devices, this endpoint
    attempts every device and reports per-device success/failure.
    """
    result = await db.execute(select(Device))
    devices = list(result.scalars().all())

    if not devices:
        raise HTTPException(status_code=404, detail="No devices found")

    results = []
    for device in devices:
        try:
            bkp = await backup_service.create_backup(
                db, device,
                backup_type="manual",
                notes="Bulk backup (all devices)",
            )
            results.append({
                "device_id": device.id,
                "device_name": device.name,
                "success": True,
                "backup_id": bkp.id,
                "filename": bkp.filename,
                "file_size": bkp.file_size,
            })
        except Exception as exc:
            results.append({
                "device_id": device.id,
                "device_name": device.name,
                "success": False,
                "error": str(exc),
            })

    await db.commit()

    success_count = sum(1 for r in results if r["success"])
    return {
        "message": f"Bulk backup completed: {success_count}/{len(results)} successful",
        "total": len(results),
        "success": success_count,
        "failed": len(results) - success_count,
        "results": results,
    }


# ---------------------------------------------------------------------------
# Parameterized routes (must come AFTER fixed paths like /auto, /compare)
# ---------------------------------------------------------------------------

@router.post("/{device_id}", status_code=201)
async def create_backup(
    device_id: int,
    payload: BackupCreate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    try:
        bkp = await backup_service.create_backup(
            db, device,
            vdom_name=payload.vdom_name,
            backup_type=payload.backup_type,
            notes=payload.notes,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {
        "id": bkp.id,
        "device_id": bkp.device_id,
        "filename": bkp.filename,
        "file_size": bkp.file_size,
        "backup_type": bkp.backup_type,
        "config_hash": bkp.config_hash,
        "created_at": bkp.created_at.isoformat() if bkp.created_at else None,
    }


@router.get("/{backup_id}/download")
async def download_backup(backup_id: int, db: AsyncSession = Depends(get_db)):
    bkp = await backup_service.get_backup_by_id(db, backup_id)
    if not bkp:
        raise HTTPException(status_code=404, detail="Backup not found")

    import os
    if not os.path.exists(bkp.filepath):
        raise HTTPException(status_code=404, detail="Backup file not found on disk")

    return FileResponse(
        path=bkp.filepath,
        filename=bkp.filename,
        media_type="application/octet-stream",
    )


@router.get("/{backup_id}/content")
async def get_backup_content(backup_id: int, db: AsyncSession = Depends(get_db)):
    bkp = await backup_service.get_backup_by_id(db, backup_id)
    if not bkp:
        raise HTTPException(status_code=404, detail="Backup not found")

    try:
        content = await backup_service.get_backup_content(bkp)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup file not found on disk")

    return {
        "id": bkp.id,
        "filename": bkp.filename,
        "content": content,
        "file_size": bkp.file_size,
    }


@router.delete("/{backup_id}")
async def delete_backup(backup_id: int, db: AsyncSession = Depends(get_db)):
    success = await backup_service.delete_backup(db, backup_id)
    if not success:
        raise HTTPException(status_code=404, detail="Backup not found")
    return {"message": "Backup deleted successfully"}
