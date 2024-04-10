import 'dotenv/config';
import { Server } from "socket.io";
import Tabel from './Tabel';

// Загрузка порта из переменных окружения или использование 3000 по умолчанию
const port = process.env.WS_PORT ? Number(process.env.WS_PORT) : 3000;

const io = new Server(port, { cors: { origin: "*" }});
const tabel = new Tabel();

io.on("connection", (socket) => {
  console.log(`Подключен пользователь: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`Пользователь отключен: ${socket.id}`);
  });

  socket.on("message", (msg) => {
    console.log(`Сообщение от ${socket.id}: ${msg}`);
    //io.emit("message", msg); // Эхо-ответ всем подключенным
  });

  tabel.on("update", (msg) => {
    console.log("Обработчик события 'update':", msg);
    //io.emit("update", msg);
});
});

console.log(`WebSocket сервер запущен на порту ${port}`);




