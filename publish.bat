@echo off
rem Publishes the app folder to GitHub Pages (gh-pages branch).
cd /d "%~dp0"
git subtree split --prefix app -b gh-pages-tmp || goto :fail
git push -f origin gh-pages-tmp:gh-pages || goto :fail
git branch -D gh-pages-tmp >nul
echo Done: https://pipiskamongolaki-lgtm.github.io/pulse-music/
pause
exit /b 0
:fail
git branch -D gh-pages-tmp >nul 2>&1
echo Publish failed.
pause
exit /b 1
