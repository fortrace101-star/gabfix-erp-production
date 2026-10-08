@echo off
echo === health ===
curl --max-time 8 -s -w "\nhealth HTTP=%{http_code}\n" http://localhost:5000/api/health
echo.
echo === owner login ===
curl --max-time 10 -s -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -H "X-App-Id: admin" -d @C:\Users\manue\Desktop\gabfix\FinanceMgt\Gabfix-ERP\server\_creds.json
echo.
echo === exit code ===
echo %ERRORLEVEL%
pause