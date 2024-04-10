import { Client } from 'pg';
//import 'dotenv/config';

interface EventMessage {
    [key: string]: any; // Определяет, что каждое сообщение - это объект с любым количеством свойств любого типа
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

    public getList(date: string): void {
        console.log(`Получение списка событий для даты: ${date}`);
    }

    private addEvent(data: object): void {
        console.log(`Добавление события: `, data);
        this.emit("update", { message: data });
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
        console.log('emit');
        
        if (!this.eventHandlers.has(event)) {
            console.log('!this.eventHandlers.has(event)');
            return;
        }

        for (const handler of this.eventHandlers.get(event)!) {
            console.log('handler');
            handler(message);
        }
    }
}

export default Tabel;
