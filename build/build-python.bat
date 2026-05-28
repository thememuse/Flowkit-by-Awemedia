@echo off
REM ============================================================
REM build/build-python.bat — Build Python agent with PyInstaller (Windows)
REM Creates: resources\agent-win\agent.exe
REM ============================================================

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PROJECT_ROOT=%SCRIPT_DIR%..
set OUTPUT_DIR=%PROJECT_ROOT%\resources\agent-win

echo ==================================================
echo   Flow Kit - Python Agent Build (Windows)
echo ==================================================
echo.
echo Project root: %PROJECT_ROOT%
echo Output dir:   %OUTPUT_DIR%
echo.

REM Check Python
where python >nul 2>&1
if errorlevel 1 (
    where python3 >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python not found. Install Python 3.10+ from python.org
        exit /b 1
    )
    set PYTHON=python3
) else (
    set PYTHON=python
)

for /f "tokens=*" %%v in ('!PYTHON! --version') do echo Python: %%v

REM Activate venv if exists
if exist "%PROJECT_ROOT%\venv\Scripts\activate.bat" (
    echo Activating venv...
    call "%PROJECT_ROOT%\venv\Scripts\activate.bat"
) else (
    echo Creating venv...
    %PYTHON% -m venv "%PROJECT_ROOT%\venv"
    call "%PROJECT_ROOT%\venv\Scripts\activate.bat"
    pip install -q --upgrade pip
    pip install -q -r "%PROJECT_ROOT%\requirements.txt"
)

REM Install PyInstaller
python -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo Installing PyInstaller...
    pip install -q pyinstaller
)

echo PyInstaller: OK

REM Clean previous builds
if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
if exist "%PROJECT_ROOT%\build-pyinstaller" rmdir /s /q "%PROJECT_ROOT%\build-pyinstaller"
mkdir "%OUTPUT_DIR%"

echo.
echo Building Python agent binary...

cd /d "%PROJECT_ROOT%"

python -m PyInstaller ^
    --onedir ^
    --name agent ^
    --distpath "%OUTPUT_DIR%" ^
    --workpath "%PROJECT_ROOT%\build-pyinstaller" ^
    --specpath "%PROJECT_ROOT%\build" ^
    --noconfirm ^
    --clean ^
    --hidden-import "aiosqlite" ^
    --hidden-import "uvicorn.logging" ^
    --hidden-import "uvicorn.loops" ^
    --hidden-import "uvicorn.loops.auto" ^
    --hidden-import "uvicorn.protocols" ^
    --hidden-import "uvicorn.protocols.http" ^
    --hidden-import "uvicorn.protocols.http.auto" ^
    --hidden-import "uvicorn.protocols.websockets" ^
    --hidden-import "uvicorn.protocols.websockets.auto" ^
    --hidden-import "uvicorn.lifespan" ^
    --hidden-import "uvicorn.lifespan.on" ^
    --hidden-import "fastapi" ^
    --hidden-import "pydantic" ^
    --hidden-import "websockets" ^
    --hidden-import "aiohttp" ^
    --hidden-import "httpx" ^
    --hidden-import "anthropic" ^
    --hidden-import "email_validator" ^
    --hidden-import "anyio" ^
    --hidden-import "starlette" ^
    --add-data "agent\models.json;agent" ^
    --collect-all "uvicorn" ^
    --collect-all "fastapi" ^
    --collect-all "starlette" ^
    "build\agent_entry.py"

if not exist "%OUTPUT_DIR%\agent\agent.exe" (
    echo.
    echo ERROR: Build failed - agent.exe not found
    exit /b 1
)

echo.
echo Build successful!
echo Binary: %OUTPUT_DIR%\agent\agent.exe

REM Cleanup
if exist "%PROJECT_ROOT%\build-pyinstaller" rmdir /s /q "%PROJECT_ROOT%\build-pyinstaller"

echo.
echo ==================================================
echo   Windows agent build complete!
echo   Output: %OUTPUT_DIR%\agent\
echo ==================================================
