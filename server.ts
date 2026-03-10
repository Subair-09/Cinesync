import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const PORT = 3000;

  // Store rooms and their participants
  // RoomID -> Set of WebSocket connections
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "join":
          const { roomId } = message;
          currentRoom = roomId;
          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId)!.add(ws);
          
          // Notify others in the room
          broadcastToRoom(roomId, ws, {
            type: "user-joined",
            userId: message.userId
          });
          break;

        case "signal":
          if (currentRoom) {
            broadcastToRoom(currentRoom, ws, {
              type: "signal",
              signal: message.signal,
              from: message.from
            });
          }
          break;

        case "chat":
          if (currentRoom) {
            broadcastToRoom(currentRoom, ws, {
              type: "chat",
              text: message.text,
              sender: message.sender,
              timestamp: new Date().toISOString()
            });
          }
          break;

        case "sync":
          // For syncing playback state (play/pause/seek)
          if (currentRoom) {
            broadcastToRoom(currentRoom, ws, {
              type: "sync",
              action: message.action,
              time: message.time
            });
          }
          break;
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
        } else {
          broadcastToRoom(currentRoom, ws, {
            type: "user-left"
          });
        }
      }
    });
  });

  function broadcastToRoom(roomId: string, sender: WebSocket, message: any) {
    const participants = rooms.get(roomId);
    if (participants) {
      const data = JSON.stringify(message);
      participants.forEach((client) => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    }
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
