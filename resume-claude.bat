@echo off
echo Waiting for Claude usage to become available...

:retry
claude -c -p "Continue the work from where you stopped. Review the current repository state, previous conversation, task list, and git diff. Continue implementing the original plan. Run the relevant tests and do not repeat completed work."

if %errorlevel% equ 0 (
    echo Claude finished successfully.
    pause
    exit /b 0
)

echo Claude is unavailable or stopped. Trying again in 10 minutes...
timeout /t 600 /nobreak
goto retry