@echo off
echo Starting FortiManager-Pro...
echo.

echo Starting Backend...
start "Backend Server" cmd /k "cd backend && python run.py"

timeout /t 2 /nobreak >nul

echo Starting Frontend...
start "Frontend Server" cmd /k "cd frontend && npm run dev"

echo.
echo Both servers are starting...
echo Backend: http://localhost:8000
echo Frontend: http://localhost:3000
echo.
echo Press any key to exit this window (servers will keep running)
pause >nul
