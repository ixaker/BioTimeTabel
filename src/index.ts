import 'dotenv/config';
import { Server } from "socket.io";
import Tabel from './Tabel';

const port = process.env.WS_PORT ? Number(process.env.WS_PORT) : 3000;

const io = new Server(port, { cors: { origin: "*" }});
const tabel = new Tabel();

io.on("connection", (socket) => {
  console.log(`socket user connected: ${socket.id}`);

  (socket as any).activeDate = '00.00.0000';

  const updateHandler = (msg: any) => {
    try {
      const activeDate = (socket as any).activeDate;
      console.log('activeDate', activeDate, msg.day);

      if (msg.day === activeDate) {
        console.log('update', msg.result);
        io.emit("update", msg.result);
      }

    } catch (error) {
      console.error('tabel update', error);
    }
  };

  const notificationHandler = (msg: any) => {
    try {
      console.log('notification', msg);
      
      io.emit("notification", msg);
    } catch (error) {
      console.error('tabel notification', error);
    }
  };
  
  socket.on("disconnect", () => {
    try {
      console.log(`socket user disconnected: ${socket.id}`);

      tabel.off("update", updateHandler);
      tabel.off("notification", notificationHandler);
    } catch (error) {
      console.error('socket disconnect', error);
    }
  });

  socket.on("getList", async (msg) => {
    try {
      (socket as any).activeDate = msg.date;

      const list = await tabel.getList(msg.date);
      io.emit("list", list);
    } catch (error) {
      console.error('socket getList', error);
    }
  });

  tabel.on("update", updateHandler);
  tabel.on("notification", notificationHandler);

});

console.log(`WebSocket server started on port: ${port}`);




