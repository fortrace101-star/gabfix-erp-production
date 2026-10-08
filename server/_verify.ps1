$api = "http://localhost:5000"
$root = "C:\Users\manue\Desktop\gabfix\FinanceMgt\Gabfix-ERP\server"
$loginJson = "$root\_login.json"
$tokFile = "$root\_token.json"
$dataFile = "$root\_data.json"
$filingsFile = "$root\_filings.json"

curl.exe -s -X POST "$api/api/auth/login" -H "Content-Type: application/json" -H "X-App-Id: portal" -d "@$loginJson" -o "$tokFile" -w "login_http=%{http_code}\n"
$login = Get-Content "$tokFile" -Raw | ConvertFrom-Json
$tok = $login.accessToken
"TOKEN: $($tok.Substring(0, 20))..."
"USER: $($login.user.name)  role=$($login.user.role)  scope=$(($login.user.app_scope -join ','))"

# Live workspace read (GET /api/data) — should contain the seeded GF jobs.
curl.exe -s "$api/api/data" -H "Authorization: Bearer $tok" -o "$dataFile" -w "data_http=%{http_code}\n"
$data = Get-Content "$dataFile" -Raw | ConvertFrom-Json
"=== GF jobs (GET /api/data, live) ==="
($data.jobs | Where-Object { $_.id -like 'GF-*' }) | ForEach-Object { "  $($_.number) | $($_.status) | rev $($_.revenue) | cost $($_.cost) | assignees=($($_.assignees -join ','))" }

# Own filings (GET /api/employees/my-filings) — John's seeded timecards + cost lines.
curl.exe -s "$api/api/employees/my-filings" -H "Authorization: Bearer $tok" -o "$filingsFile" -w "filings_http=%{http_code}\n"
$f = Get-Content "$filingsFile" -Raw | ConvertFrom-Json
"=== John /my-filings ==="
"timesheets: $($f.timesheets.Count)"
$f.timesheets | ForEach-Object { "  $($_.jobNumber) approved=$($_.approved) min=$($_.minutes)" }
"costs: $($f.costs.Count)"
$f.costs | ForEach-Object { "  $($_.description) = $($_.amount)" }
