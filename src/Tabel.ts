import { Client } from 'pg';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

//import 'dotenv/config';

interface EventMessage {
    [key: string]: any; // Определяет, что каждое сообщение - это объект с любым количеством свойств любого типа
}

interface rowDataForWebClient {
    id: number;         // id рядка
    name: string;       // ПІБ працівника
    type: "d" | "n";    // тип зміни бути тільки "d" - денна або "n" - нічна
    arrival: string;    // прихід
    departure: string;  // ухід
    duration: string;   // тривалість зміни
    total: string;      // час, який зараховується
}

interface rowNewData {
    id: number;
    emp_code: string;
    punch_time: Date;
    punch_state: "0" | "1";
    first_name: string;
    day: string;
}

class Tabel {
    private dbClient: Client;
    private eventHandlers: Map<string, Function[]> = new Map();

    private readonly reconnectInterval = 10000; // Интервал для переподключения
    private readonly downloadInterval = 20000; // Интервал для переподключения

    constructor() {
        this.dbClient = new Client({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            password: process.env.DB_PASS,
            port: parseInt(process.env.DB_PORT || '7496', 10)
        });

        this.connectToDb();
        
        setInterval(() => { this.downloadEvent(); }, this.downloadInterval);
        this.downloadEvent();
    }

    private connectToDb(): void {
        this.dbClient.connect(err => {
            if (err) {
                console.error('Ошибка подключения к базе данных:', err);
                setTimeout(() => this.connectToDb(), this.reconnectInterval);
            } else {
                console.log('Успешно подключено к базе данных.');

                this.checkExistTable();

                this.dbClient.on('notification', (msg: any) => {
                    try {
                        const payload = JSON.parse(msg.payload);
                        payload.notification = true; 
                        payload.punch_time = new Date(payload.punch_time);  
                        
                        //console.log('notification', payload);
                        
                        this.addEvent(payload);
                    } catch (error) {
                        console.error('Ошибка при разборе JSON:', error);
                    }
                });
                
                this.dbClient.on('error', () => {
                    console.error('Подключение к базе данных было потеряно. Попытка переподключения.');
                    this.connectToDb();
                });

                this.dbClient.query('LISTEN event_channel');
            }
        });
    }

    public async getList(date: string): Promise<rowDataForWebClient[]> {
        console.log(`Получение списка событий для даты: ${date}`);

        const query = `SELECT * FROM tabel WHERE date = $1;`;
        const values = [date];
        const res = await this.dbClient.query(query, values);

        const rowDataArray = res.rows.map(row => ({
            id: row.id,
            name: row.name,
            type: row.type,
            arrival: row.arrival,
            departure: row.departure,
            duration: row.duration,
            total: row.total
        }));

        //console.log('list', rowDataArray);
        
        return rowDataArray;


        const result: rowDataForWebClient[] = [
            {
                id: 1,
                name: "Іваненко Іван Іванович",
                type: "d",
                arrival: "08:00",
                departure: "17:00",
                duration: "08:00",
                total: "07:00",
            },
            {
                id: 2,
                name: "Петренко Петро Петрович",
                type: "n",
                arrival: "22:00",
                departure: "06:00",
                duration: "08:00",
                total: "07:00",
            },
            { 
                id: 3, 
                name: "Амариуца Валентин", 
                type: "n", 
                arrival: "05:57", 
                departure: "02:57", 
                duration: "02:57", 
                total: "02:57" 
            }
          ];

        return result;
    }

    private async addEvent(data: any): Promise<void> {
        const newData = this.getNewDataFromObject(data);
        const oldData = await this.getLastUserEvent(newData.emp_code, newData.punch_time);

        const notification = {
            first_name: newData.first_name,
            time: this.getTimeFromDate(newData.punch_time),
            state: newData.punch_state === "0" ? "Приход" : "Уход",
            error: false,
            msg: ''
        }

        if (oldData.punch_state === undefined) {
            if (newData.punch_state === '1') {
                notification.error = true;
                notification.msg = 'Можливо помилка, попередній "Приход" не знайдено';
            }
        }else{
            if (newData.punch_state === oldData.punch_state) {
                notification.error = true;
                notification.msg = 'Можливо помилка';

                const time = this.getTimeFromDate(oldData.punch_time);

                if (newData.punch_state === '0') {  // якщо перед цим був теж приход то можливо помилка
                    notification.msg += ', перед цим був теж "Приход"'
                }else{  // якщо перед цим був теж уход то можливо помилка, або забув відмітити "Приход"
                    notification.msg += ', перед цим був теж "Уход"'
                }

                notification.msg += ' - ' + time;
            }
        }

        if (!notification.error) {
            let result: any = {};

            if (newData.punch_state === '0') {  // якщо приход
                result = await this.insertRowArrivalToTabel(newData);
            }else{                              // якщо уход
                result = await this.updateRowDeparture(newData, oldData.id);
            }

            if (result !== undefined) {
                const update = {day: '11.04.2024', result: this.getNewDataForWebClientFromObject(result)}
                this.emit("update", update);
                this.emit("notification", notification);
            }
            
        }else{
            this.emit("notification", notification);
            this.setErrorRowEvent(newData.id);
        }

    }

    private async downloadEvent(): Promise<void> {
        //console.log('start downloadEvent');
        
        try {
            const queryText = `
                SELECT 
                    t.*,
                    e.first_name
                FROM 
                    iclock_transaction t
                JOIN 
                    personnel_employee e ON t.emp_code = e.emp_code
                WHERE 
                    t.id > $1 
                ORDER BY 
                    t.id ASC
                LIMIT 30;
            `;
    
            const ID_EVNT = parseInt(process.env.ID_EVNT || '30000', 10); // Преобразуем значение переменной окружения в число
            const values = [ID_EVNT];
            const res = await this.dbClient.query(queryText, values);
    
            console.log('rows', res.rows.length);
    
            for (const row of res.rows) {
                row.notification = false;
                this.addEvent(row);
                this.saveVarDotENV('ID_EVNT', row.id);
            }
    
        } catch (error) {
            console.error('Error in downloadEvent() :', error);
        }
    }
    
    public on(event: string, handler: (msg: EventMessage) => void): void {
        console.log('tabel on', event);
        
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event)!.push(handler);
    }

    public off(event: string, handler: (msg: EventMessage) => void): void {
        console.log('tabel off', event);

        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            const newHandlers = handlers.filter(h => h !== handler);
            this.eventHandlers.set(event, newHandlers);
        }
    }

    private emit(event: string, message: EventMessage): void {
        if (!this.eventHandlers.has(event)) {
            return;
        }

        for (const handler of this.eventHandlers.get(event)!) {
            handler(message);
        }
    }

    private async checkExistTable(): Promise<void> {
        try {
            // Проверяем наличие таблицы
            const checkQuery = `
                SELECT EXISTS (
                    SELECT FROM pg_tables
                    WHERE schemaname = 'public' AND tablename  = 'tabel'
                );
            `;
            const checkRes = await this.dbClient.query(checkQuery);
            const exists = checkRes.rows[0].exists;

            if (!exists) {
                // Создаем таблицу, если она не существует
                const createQuery = `
                    CREATE TABLE tabel (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(25),
                        type CHAR(1) CHECK (type IN ('d', 'n')),
                        arrival CHAR(5),
                        departure CHAR(5),
                        duration CHAR(5),
                        total CHAR(5),
                        date CHAR(10),
                        emp_code CHAR(20),
                        arrival_id integer,
                        arrival_date timestamp with time zone,
                        departure_date timestamp with time zone
                    );
                `;
                await this.dbClient.query(createQuery);
                console.log("Таблица 'iclock_transaction' создана.");
            } else {
                console.log("Таблица 'iclock_transaction' уже существует.");
            }
        } catch (error) {
            console.error("Ошибка при проверке или создании таблицы:", error);
        }
    }

    private getNewDataFromObject(data: any): rowNewData {
        const { id, emp_code, punch_time, punch_state, first_name } = data;
        const day = this.getDayFromDate(punch_time);
        return { id, emp_code, punch_time, punch_state, first_name, day };
    }

    private getNewDataForWebClientFromObject(data: any): rowDataForWebClient {
        const { id, name, type, arrival, departure, duration, total } = data;
        return { id, name, type, arrival, departure, duration, total };
    }

    private getDayFromDate(dateString: any): string {
        const date = new Date(dateString);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}.${month}.${year}`;
    }

    private getTimeFromDate(dateString: any): string {
        const date = new Date(dateString);
        const hour = date.getHours().toString().padStart(2, '0');
        const minute = date.getMinutes().toString().padStart(2, '0');

        return `${hour}:${minute}`;
    }

    private async getLastUserEvent(emp_code: string, date: Date): Promise<rowNewData> {
        try {
            const queryText = `
                SELECT 
                    t.*,
                    e.first_name
                FROM 
                    iclock_transaction t
                JOIN 
                    personnel_employee e ON t.emp_code = e.emp_code
                WHERE 
                    t.emp_code = $1 
                    AND t.punch_time < $2 
                    AND t.punch_time > $3 
                    AND t.error = false
                ORDER BY 
                    t.id DESC
                LIMIT 1;
            `;

            const minDate = new Date(date.getTime() - 20 * 60 * 60 * 1000);
            const values = [emp_code, date, minDate];
            const res = await this.dbClient.query(queryText, values);
            const data = res.rows.length > 0 ? res.rows[0] : {};  
            const newData = this.getNewDataFromObject(data);

            return newData;

        } catch (error) {
            const data = {};
            const newData = this.getNewDataFromObject(data); 
            return newData;  
        }
    }

    private saveVarDotENV(key: string, value: any): void {
        process.env[key] = String(value);
        
        const envFilePath = '.env';
        const envConfig = dotenv.parse(fs.readFileSync(envFilePath));
        envConfig[key] = value;
        
        const updatedEnvData = Object.entries(envConfig).map(([key, value]) => `${key}=${value}`).join('\n');

        fs.writeFileSync(envFilePath, updatedEnvData);
    } 

    private async insertRowArrivalToTabel(data: rowNewData): Promise<any> {
        const selectQuery = `SELECT * FROM tabel WHERE arrival_id = $1;`;

        let needInsertRow = true;

        try {
            // Выполняем SQL-запрос с использованием arrival_id из переменной
            const result = await this.dbClient.query(selectQuery, [data.id]);
        
            if (result && result.rowCount !== null) {
                if (result.rowCount > 0) {
                    needInsertRow = false;
                }
            }
        } catch (error) {
            console.error('Ошибка при поиске строки:', error);
        }



        if (needInsertRow) {
            const insertQuery = `INSERT INTO tabel (name, type, arrival, departure, duration, total, date, emp_code, arrival_id, arrival_date)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *; `;

            const arrival = this.getTimeFromDate(data.punch_time);
            const smena = arrival > "16:00" ? "n" : "d";
            const values = [data.first_name, smena, arrival, '', '', '', data.day, data.emp_code, data.id, data.punch_time];

            try {
                const result = await this.dbClient.query(insertQuery, values);
                const insertedRow = result.rows[0];
                
                return insertedRow;
                //console.log('Новая строка была успешно добавлена:', insertedRow);
            } catch (error) {
                console.error('Ошибка при добавлении новой строки:', error);
            }
        }
    }

    private async updateRowDeparture(data: rowNewData, arrival_id: number): Promise<any> {
        try {
            const selectQuery = `SELECT * FROM tabel WHERE arrival_id = $1;`;

            try {
                const result = await this.dbClient.query(selectQuery, [arrival_id]);
            
                if (result && result.rowCount !== null) {
                    if (result.rowCount > 0) {
                        

                        const difference = data.punch_time.getTime() - result.rows[0].arrival_date.getTime();
                        const hours = Math.floor(difference / (1000 * 60 * 60));
                        const minutes = Math.floor((difference / (1000 * 60)) % 60);
                        const formattedHours = hours.toString().padStart(2, '0');
                        const formattedMinutes = minutes.toString().padStart(2, '0');
                        const diffTime = `${formattedHours}:${formattedMinutes}`;

                        const updateQuery = `UPDATE tabel SET departure = $1, departure_date = $2, duration = $3 WHERE arrival_id = $4 RETURNING *;`;  
                        const departure = this.getTimeFromDate(data.punch_time);
                        const values = [ departure, data.punch_time, diffTime, arrival_id ];
                        const result2 = await this.dbClient.query(updateQuery, values);
                        const updatedRow = result2.rows[0];

                        return updatedRow;
                        //console.log('Строка успешно обновлена:', updatedRow);
                    }
                }
            } catch (error) {
                console.error('Ошибка при поиске строки:', error);
            }

        } catch (error) {
            console.error('ERROR updateRowDeparture', error);
        }
    } 

    private async setErrorRowEvent(id: number) : Promise<void> {
        try {
            const updateQuery = `UPDATE iclock_transaction SET error = $1 WHERE id = $2 RETURNING *;`;  
            const result2 = await this.dbClient.query(updateQuery, [ true, id ]);
            const updatedRow = result2.rows[0];

            console.log('setErrorRowEvent updatedRow', updatedRow);
            
        } catch (error) {
            console.error('ERROR setErrorRowEvent', error);
        }
    }
}


export default Tabel;




