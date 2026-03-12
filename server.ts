import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Passport configuration
passport.serializeUser((user: any, done) => {
  done(null, user);
});

passport.deserializeUser((user: any, done) => {
  done(null, user);
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const baseUrl = (process.env.APP_URL || "http://localhost:3000").trim();
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID.trim(),
        clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
        callbackURL: `${baseUrl}/auth/google/callback`,
        proxy: true,
      },
      (accessToken, refreshToken, profile, done) => {
        return done(null, {
          id: profile.id,
          displayName: profile.displayName,
          email: profile.emails?.[0]?.value,
          photo: profile.photos?.[0]?.value,
        });
      }
    )
  );
}

async function startServer() {
  const app = express();
  app.enable("trust proxy");
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const PORT = 3000;

  // Session configuration for iframe compatibility
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "cinesync-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: true,
        sameSite: "none",
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());
  app.use(express.json());

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Auth Routes
  app.get("/api/auth/url", (req, res) => {
    try {
      if (!process.env.GOOGLE_CLIENT_ID) {
        console.error("Missing GOOGLE_CLIENT_ID");
        return res.status(500).json({ error: "Google Client ID not configured" });
      }
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).trim();
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID.trim(),
        redirect_uri: `${baseUrl}/auth/google/callback`,
        response_type: "code",
        scope: "profile email",
        access_type: "offline",
        prompt: "consent",
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      res.json({ url: authUrl });
    } catch (err) {
      console.error("Error generating auth URL:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login-failed" }),
    (req, res) => {
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    }
  );

  app.get("/api/auth/me", (req, res) => {
    res.json(req.user || null);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      res.json({ success: true });
    });
  });

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
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`App URL: ${process.env.APP_URL}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
