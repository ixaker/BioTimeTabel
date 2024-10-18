import { Client } from 'pg';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import axios from 'axios';
import delay from './utils';

enum errorType {
    null_Uhod,
    Uhod_Uhod,
    Prihod_Prihod
}

interface Notification {
    first_name: string;
    time: string;
    state: string;
    error: boolean;
    errorType?: errorType;  // Опциональное поле, может быть не задано
    newEvent: rowNewData;
    oldEvent: rowNewData;
    terminal_sn: string;
    profa: string;
    company: string;
}

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
    terminal_sn: string;
}



class Tabel {
    private dbClient: Client;
    private eventHandlers: Map<string, Function[]> = new Map();

    private readonly reconnectInterval = 10000; // Интервал для переподключения
    private readonly downloadInterval = 20000; // Интервал для скаживания пропущенных событий
    private readonly syncTo1CInterval = 20000; // Интервал для синхронизации с 1С

    private lastEventID: number = 0;

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

        setInterval(() => { this.syncTabel(); }, this.syncTo1CInterval);
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
                        payload.punch_time = new Date(payload.punch_time);
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

    public async getList(date: string): Promise<Array<any[]>> {
        console.log(`Получение списка событий для даты: ${date}`);

        const query = `SELECT * FROM tabel WHERE date = $1;`;
        const res = await this.dbClient.query(query, [date]);

        const rowDataArray = res.rows.map(row => [
            row.id,
            row.name,
            row.type,
            row.arrival,
            row.departure,
            row.duration,
            row.total
        ]);

        return rowDataArray;
    }

    private async addEvent(data: any): Promise<void> {
        const newData = this.getNewDataFromObject(data);
        const oldData = await this.getLastUserEvent(newData.emp_code, newData.punch_time, newData.id);

        if (this.lastEventID == newData.id) { return; } else { this.lastEventID = newData.id; }

        const notification = await this.getMsgNotification(newData, oldData)
        this.runNotification(notification);
    }

    private async runNotification(notification: Notification): Promise<void> {
        if (!notification.error) {
            let day = notification.newEvent.day;
            let result: any = {};

            if (notification.newEvent.punch_state === '0') {  // якщо приход
                result = await this.insertRowArrivalToTabel(notification.newEvent);
            } else {                              // якщо уход
                result = await this.updateRowDeparture(notification.newEvent, notification.oldEvent.id);
                day = notification.oldEvent.day;
            }

            if (result !== undefined) {
                const update = { day: day, result: this.getNewDataForWebClientFromObject(result) }
                this.emit("update", update);
                this.emit("notification", notification);
                this.syncRowFromTabelTo1C(result);
            }

        } else {
            this.emit("notification", notification);
            this.setErrorRowEvent(notification.newEvent.id, true);
        }
    }


    private async getMsgNotification(newData: rowNewData, oldData: rowNewData): Promise<Notification> {

        let userInfo = null;
        try {
            const response = await axios.post(`https://wss.qpart.com.ua/getUserByEmpCode?empCode=${newData.emp_code}`);
            userInfo = response.data;
            console.log("User Info:", userInfo);
        } catch (error) {
            console.error("Error fetching user by emp code:", error);
        }


        const notification: Notification = {
            first_name: newData.first_name,
            time: this.getTimeFromDate(newData.punch_time),
            state: newData.punch_state === "0" ? "Приход" : "Уход",
            error: false,
            newEvent: newData,
            oldEvent: oldData,
            terminal_sn: newData.terminal_sn,
            profa: userInfo.profa,
            company: userInfo.Организация.Наименование

        }

        if (oldData.punch_state === undefined) {
            if (newData.punch_state === '1') {
                notification.error = true;
                notification.errorType = errorType.null_Uhod;
            }
        } else {
            if (newData.punch_state === oldData.punch_state) {
                notification.error = true;

                if (newData.punch_state === '0') {  // якщо перед цим був теж приход то можливо помилка
                    notification.errorType = errorType.Prihod_Prihod;
                } else {  // якщо перед цим був теж уход то можливо помилка, або забув відмітити "Приход"
                    notification.errorType = errorType.Uhod_Uhod;
                }
            }
        }

        return notification;
    }

    private async downloadEvent(): Promise<void> {
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
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event)!.push(handler);
    }

    public off(event: string, handler: (msg: EventMessage) => void): void {
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
            const checkQuery = `SELECT EXISTS ( SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'tabel' );`;
            const checkRes = await this.dbClient.query(checkQuery);
            const exists = checkRes.rows[0].exists;

            if (!exists) {
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
                        departure_date timestamp with time zone,
                        sync boolean NOT NULL DEFAULT false,
                        terminal_sn CHAR(25)
                    );
                `;
                await this.dbClient.query(createQuery);
            }
        } catch (error) {
            console.error("Ошибка при проверке или создании таблицы:", error);
        }
    }

    private getNewDataFromObject(data: any): rowNewData {
        const { id, emp_code, punch_time, punch_state, first_name, terminal_sn } = data;
        const day = this.getDayFromDate(punch_time);
        return { id, emp_code, punch_time, punch_state, first_name, day, terminal_sn };
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

    private async getLastUserEvent(emp_code: string, date: Date, id: number): Promise<rowNewData> {
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
                    AND t.id < $2 
                    AND t.punch_time > $3 
                    AND t.error = false
                ORDER BY 
                    t.id DESC
                LIMIT 1;
            `;

            const minDate = new Date(date.getTime() - 20 * 60 * 60 * 1000);
            const values = [emp_code, id, minDate];
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
            const insertQuery = `INSERT INTO tabel (name, type, arrival, departure, duration, total, date, emp_code, arrival_id, arrival_date, terminal_sn)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *; `;

            const arrival = this.getTimeFromDate(data.punch_time);
            const smena = arrival > "16:00" ? "n" : "d";
            const values = [data.first_name, smena, arrival, '', '', '', data.day, data.emp_code, data.id, data.punch_time, data.terminal_sn];

            try {
                const result = await this.dbClient.query(insertQuery, values);
                const insertedRow = result.rows[0];
                return insertedRow;
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
                        const punch_time = data.punch_time;
                        punch_time.setSeconds(0, 0);

                        const arrival_date = result.rows[0].arrival_date;
                        arrival_date.setSeconds(0, 0);

                        const difference = punch_time.getTime() - arrival_date.getTime();
                        const hours = Math.floor(difference / (1000 * 60 * 60));
                        const minutes = Math.floor((difference / (1000 * 60)) % 60);
                        const formattedHours = hours.toString().padStart(2, '0');
                        const formattedMinutes = minutes.toString().padStart(2, '0');
                        const diffTime = `${formattedHours}:${formattedMinutes}`;

                        const updateQuery = `UPDATE tabel SET departure = $1, departure_date = $2, duration = $3, sync = $4 WHERE arrival_id = $5 RETURNING *;`;
                        const departure = this.getTimeFromDate(data.punch_time);
                        const values = [departure, data.punch_time, diffTime, false, arrival_id];
                        const result2 = await this.dbClient.query(updateQuery, values);
                        const updatedRow = result2.rows[0];

                        return updatedRow;
                    }
                }
            } catch (error) {
                console.error('Ошибка при поиске строки:', error);
            }

        } catch (error) {
            console.error('ERROR updateRowDeparture', error);
        }
    }

    private async setErrorRowEvent(id: number, state: boolean): Promise<any> {
        try {
            const updateQuery = `UPDATE iclock_transaction SET error = $1 WHERE id = $2 RETURNING *;`;
            const result = await this.dbClient.query(updateQuery, [state, id]);
            const updatedRow = result.rows[0];
            return updatedRow;
        } catch (error) {
            console.error('ERROR setErrorRowEvent', error);
        }
    }

    public async setStateEventIsFalse(date: Notification): Promise<void> {
        const newData = date.newEvent;
        newData.punch_state = newData.punch_state === "0" ? "1" : "0";

        const updateQuery = `UPDATE iclock_transaction SET punch_state = $1, error = $2 WHERE id = $3 RETURNING *;`;
        const values = [newData.punch_state, false, newData.id];
        const result = await this.dbClient.query(updateQuery, values);
        const updatedRow = result.rows[0];

        updatedRow.first_name = newData.first_name;

        this.lastEventID = 0;
        this.addEvent(updatedRow);
    }

    public setStateEventIsTrue(notification: Notification): void {
        console.log('setStateEventIsTrue', notification);

        this.setErrorRowEvent(notification.newEvent.id, false);
        notification.error = false;
        this.runNotification(notification);
    }

    private async syncTabel(): Promise<void> {
        console.log('syncTabel');

        try {
            const queryText = `SELECT * FROM public.tabel WHERE sync = false ORDER BY id ASC LIMIT 5;`;
            const res = await this.dbClient.query(queryText);

            for (const row of res.rows) {
                this.syncRowFromTabelTo1C(row);
                delay(2000);
            }

        } catch (error) {
            console.error('Error in syncTabel() : ', error);
        }
    }

    private async syncRowFromTabelTo1C(data: any): Promise<void> {
        try {
            const url = `http://${process.env['1C_HOST']}/${process.env['1C_BASE']}/hs/tabel/update`;
            const auth = { username: process.env['1C_USER'] || '', password: process.env['1C_PASS'] || '' };
            const response = await axios.post(url, data, { auth: auth });

            console.log('syncRowFromTabelTo1C', response.data);


            if (!response.data.error) {
                let total = response.data.total;
                this.setTotalTimeForRowTabel(response.data.id, total)
            }
        } catch (error) {
            console.error('Error syncRowFromTabelTo1C() : ', error);
        }
    }

    private async setTotalTimeForRowTabel(id: number, total: string): Promise<void> {
        try {
            const updateQuery = `UPDATE tabel SET total = $1, sync = $2 WHERE id = $3 RETURNING *;`;
            const values = [total, true, id];
            const result = await this.dbClient.query(updateQuery, values);
            const updatedRow = result.rows[0];

            if (result !== undefined) {
                const update = { day: updatedRow.date, result: this.getNewDataForWebClientFromObject(updatedRow) }
                this.emit("update", update);
            }
        } catch (error) {
            console.error('Error setTotalTimeForRowTabel() : ', error);
        }
    }

}

export default Tabel;

