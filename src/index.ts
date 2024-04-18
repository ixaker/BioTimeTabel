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

      if (msg.day === activeDate) {
        socket.emit("update", msg.result);
      }

    } catch (error) {
      console.error('tabel update', error);
    }
  };

  const notificationHandler = (msg: any) => {
    try {
      const terminal_sns: string[] = (socket as any).terminal_sns||[];
      const result: boolean = terminal_sns.length === 0 || terminal_sns.includes(msg.terminal_sn||'');

      if (result) {
        socket.emit("notification", msg);
      }
      
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
      console.log('getList', msg);
      
      (socket as any).activeDate = msg.date;

      const terminal_sns: string[] = [];

      if ("terminal_sns" in msg) {
        msg.terminal_sns.forEach((sn: string) => {
          terminal_sns.push(sn);
        });
      }

      (socket as any).terminal_sns = terminal_sns;
      
      const list = await tabel.getList(msg.date);
      socket.emit("list", list);  
    } catch (error) {
      console.error('socket getList', error);
    }
  });

  socket.on("trueEvent", async (msg) => {
    try {
      tabel.setStateEventIsTrue(msg);
    } catch (error) {
      console.error('socket trueEvent', error);
    }
  });

  socket.on("falseEvent", async (msg) => {
    try {
      tabel.setStateEventIsFalse(msg);
    } catch (error) {
      console.error('socket falseEvent', error);
    }
  });

  tabel.on("update", updateHandler);
  tabel.on("notification", notificationHandler);

});

console.log(`WebSocket server started on port: ${port}`);




