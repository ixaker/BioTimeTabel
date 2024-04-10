import 'dotenv/config';
import { Server } from "socket.io";
import Tabel from './Tabel';

const port = process.env.WS_PORT ? Number(process.env.WS_PORT) : 3000;

const io = new Server(port, { cors: { origin: "*" }});
const tabel = new Tabel();

io.on("connection", (socket) => {
  console.log(`socket user connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`socket user disconnected: ${socket.id}`);
  });

  socket.on("getList", async (msg) => {
    console.log('socket getList', msg);
    const list = await tabel.getList(msg.date);
    io.emit("list", list);
  });

  tabel.on("update", (msg) => {
    console.log('tabel update', msg);
    io.emit("update", msg);
  });

});

console.log(`WebSocket server started on port: ${port}`);




