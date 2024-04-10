import { Client } from 'pg';
//import 'dotenv/config';

interface EventMessage {
    [key: string]: any; // Определяет, что каждое сообщение - это объект с любым количеством свойств любого типа
}

interface rowData {
    id: number;         // id рядка
    name: string;       // ПІБ працівника
    type: "d" | "n";    // тип зміни бути тільки "d" - денна або "n" - нічна
    arrival: string;    // прихід
    departure: string;  // ухід
    duration: string;   // тривалість зміни
    total: string;      // час, який зараховується
}


class Tabel {
    private dbClient: Client;
    private eventHandlers: Map<string, Function[]> = new Map();

    private readonly reconnectInterval = 10000; // Интервал для переподключения
    private readonly downloadInterval = 90000; // Интервал для переподключения

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
    }

    private connectToDb(): void {
        this.dbClient.connect(err => {
            if (err) {
                console.error('Ошибка подключения к базе данных:', err);
                setTimeout(() => this.connectToDb(), this.reconnectInterval);
            } else {
                console.log('Успешно подключено к базе данных.');

                this.dbClient.on('notification', (msg: any) => {
                    try {
                        const payload = JSON.parse(msg.payload);
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

    public async getList(date: string): Promise<rowData[]> {
        console.log(`Получение списка событий для даты: ${date}`);

        const result: rowData[] = [
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

    private addEvent(data: object): void {
        console.log(`Добавление события: `, data);

        const result: rowData = {
                id: 1,
                name: "Іваненко Іван Іванович",
                type: "d",
                arrival: "08:00",
                departure: "17:00",
                duration: "08:00",
                total: "07:00",
            }

        this.emit("update", result);
    }

    private downloadEvent(): void {
        console.log(`Скачивание событий`);
    }

    public on(event: string, handler: (msg: EventMessage) => void): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event)!.push(handler);
    }

    private emit(event: string, message: EventMessage): void {
        if (!this.eventHandlers.has(event)) {
            return;
        }

        for (const handler of this.eventHandlers.get(event)!) {
            handler(message);
        }
    }
}

export default Tabel;
