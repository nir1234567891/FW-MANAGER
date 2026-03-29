import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "FortiManager Pro"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True

    DATABASE_URL: str = "sqlite+aiosqlite:///./fortimanager.db"
    BACKUP_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "backups")

    SECRET_KEY: str = "fortimanager-pro-secret-key-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    API_REQUEST_TIMEOUT: int = 30
    API_CONNECT_TIMEOUT: int = 10

    FORTIGATE_DEFAULT_PORT: int = 443
    FORTIGATE_VERIFY_SSL: bool = False

    AUTO_BACKUP_INTERVAL_HOURS: int = 24
    DEVICE_POLL_INTERVAL_SECONDS: int = 300

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
