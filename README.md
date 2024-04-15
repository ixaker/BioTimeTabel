# BioTimeTabel

таблица : personnel_employee
таблица : iclock_transaction


# .env
DB_HOST=localhost
DB_USER=postgres
DB_PASS=Postgres2023!
DB_NAME=biotime
DB_PORT=7496
WS_PORT=3000
ID_EVNT=30000




# install Nginx as service

качаем архив - nginx-1.25.4.zip с офф сайта - https://nginx.org/ru/download.html
рапаковываем в папку C:\nginx

для того чтоб создать службу автоматического запуска:
качаем архив - nssm-2.24.zip с офф сайта - https://nssm.cc/download
рапаковываем в папку C:\nssm

run PowerShell as Administrator:

cd C:\nssm\win64
.\nssm.exe install Nginx "C:\nginx\nginx.exe"
.\nssm.exe set Nginx AppDirectory "C:\nginx"
.\nssm.exe set Nginx Start "SERVICE_AUTO_START"
.\nssm.exe start Nginx
.\nssm.exe status Nginx

for backend:
.\nssm.exe install Tabel "C:\nodejs\node.exe" "C:\dev\BioTimeTabel\dist\index.js"
.\nssm.exe set Tabel Application "C:\nodejs\node.exe"
.\nssm.exe set Tabel AppDirectory "C:\dev\BioTimeTabel"
.\nssm.exe set Tabel AppParameters "dist\index.js"
.\nssm.exe set Tabel AppRestartDelay 5000  // Пауза перед перезапуском в миллисекундах
.\nssm.exe set Tabel AppExit Default Restart  // Перезапуск при любом типе завершения приложения
.\nssm.exe set Tabel AppStdout "C:\dev\BioTimeTabel\logs\stdout.log"
.\nssm.exe set Tabel AppStderr "C:\dev\BioTimeTabel\logs\stderr.log"
.\nssm.exe set Tabel AppRotateFiles 1  // Включить ротацию файлов журнала
.\nssm.exe start Tabel
.\nssm.exe status Tabel
net stop Tabel


