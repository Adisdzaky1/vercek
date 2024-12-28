const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');  // Import socket.io
const utf8 = require("utf8");
const SSHClient = require("ssh2").Client;
const pino = require("pino");
const { Client } = require('pg');  // Import PostgreSQL client
const app = express();
const fs = require('fs');
const pg = require('pg');
const url = require('url');
const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  },
  pino.destination("./server.log")
);

// PostgreSQL client setup
const connectionString = 'postgresql://postgres.uuqfnngkeheonzancwlt:Asep@@12344@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';

// Buat Pool untuk koneksi database
const dbClient = new pg.Client({
    connectionString,
    ssl: {
        rejectUnauthorized: false // Atur SSL jika diperlukan
    },
});

dbClient.connect();

// Create HTTP server
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3101;

// Set up EJS view engine
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(session({
    secret: 'secretkey',
    resave: false,
    saveUninitialized: true
}));
app.use((req, res, next) => {
    res.locals.user = req.session.user || null; // Add `user` to `res.locals`
    next();
});

// Route for the login page
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');  // Redirect to dashboard if already logged in
    }
    res.render('login');  // Render login page
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error during logout:', err);
            return res.status(500).send('Something went wrong while logging out.');
        }
        res.redirect('/'); // Redirect to login page after logout
    });
});

// Login POST route
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await dbClient.query(
            'SELECT * FROM users WHERE username = $1 AND password = $2',
            [username, password]
        );
        if (result.rows.length === 0) {
            return res.status(401).send('Invalid username or password');
        }

        const user = result.rows[0];
        req.session.user = user;
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error during login:', err);
        res.status(500).send('Something went wrong during login');
    }
});

// Dashboard page
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');  // Redirect ke login jika tidak ada sesi
    }

    // Jika req.session.user.vps berupa string JSON, parse hanya properti 'vps'
    if (typeof req.session.user.vps === 'string') {
        req.session.user.vps = JSON.parse(req.session.user.vps); // Ubah menjadi objek
    }

    console.log(req.session.user.vps); // Debug: tampilkan data vps

    // Render halaman dashboard dengan user dari session
    res.render('dashboard', { user: req.session.user });
});

// VPS routes
const vpsRouter = require('./routes/vps');
app.use('/vps', vpsRouter);

// Register routes
app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await dbClient.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        if (result.rows.length > 0) {
            return res.status(400).send('Username already exists');
        }

        const newUser = {
            username: username,
            password: password,
            role: 'user',
            vps: null // No VPS assigned initially
        };

        await dbClient.query(
            'INSERT INTO users (username, password, role, vps) VALUES ($1, $2, $3, $4)',
            [newUser.username, newUser.password, newUser.role, newUser.vps]
        );

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error during registration:', err);
        res.status(500).send('Something went wrong during registration');
    }
});

io.on("connection", (socket) => {
    logger.info("SERVER SOCKET CONNECTION CREATED :", socket.id);
    const data = socket.handshake.query;
    console.log("SSH INFO COK", data);

    // The rest of your socket.io logic remains unchanged
    if (data.type == "webshell") {
        logger.info("Connection type : webshell");
        let ssh = new SSHClient(); // Gunakan let untuk variabel yang akan diubah
        ssh
            .on("ready", function () {
                socket.emit("data", "\r\n*** SSH CONNECTION ESTABLISHED ***\r\n\n");
                logger.debug("SSH CONNECTION ESTABLISHED for socket" + socket.id);
                connected = true;
                ssh.shell(function (err, stream) {
                    if (err) {
                        logger.debug(
                            "SSH SHELL ERROR: " + err.message + " for socket" + socket.id
                        );
                        logger.debug(err);
                        return socket.emit(
                            "data",
                            "\r\n*** SSH SHELL ERROR: " + err.message + " ***\r\n"
                        );
                    }
                    socket.on("data", function (data) {
                        logger.debug("Socket ID::" + socket.id + " on data ::");
                        logger.debug(data);
                        stream.write(data);
                    });
                    stream
                        .on("data", function (d) {
                            logger.debug(
                                "Socket ID::" + socket.id + " ssh stream on data ::"
                            );
                            logger.debug(utf8.decode(d.toString("binary")));
                            socket.emit("data", utf8.decode(d.toString("binary")));
                        })
                        .on("close", function () {
                            logger.debug(
                                "Socket ID::" +
                                socket.id +
                                " ssh stream on close() :: Going to call ssh.end()"
                            );
                            ssh.end();
                        });
                });
            })
            .on("close", function () {
                logger.debug(
                    "Socket ID::" + socket.id + " ssh on close() :: SSH CONNECTION CLOSED"
                );
                socket.emit("data", "\r\n*** SSH CONNECTION CLOSED ***\r\n");
            })
            .on("error", function (err) {
                logger.debug(err);
                logger.debug(
                    "Socket ID::" +
                    socket.id +
                    " ssh on error ::SSH CONNECTION ERROR: " +
                    err.message
                );
                socket.emit(
                    "data",
                    "\r\n*** SSH CONNECTION ERROR: " + err.message + " ***\r\n"
                );
            })
            .connect({
                host: data.hostname,
                port: data.port,
                username: data.username,
                password: data.password,
            });
    } else if (data.type == "exec") {
        logger.info("Connection type: exec");
        let ssh = new SSHClient(); // Gunakan let untuk variabel yang akan diubah
        ssh
            .on("ready", function () {
                socket.emit("data", "\r\n*** SSH CONNECTION ESTABLISHED ***\r\n");
                logger.debug("SSH CONNECTION ESTABLISHED for socket" + socket.id);
                connected = true;
                ssh.exec(data.command, function (err, stream) {
                    if (err) {
                        logger.debug(
                            "SSH SHELL ERROR: " + err.message + " for socket" + socket.id
                        );
                        logger.debug(err);
                        return socket.emit(
                            "data",
                            "\r\n*** SSH SHELL ERROR: " + err.message + " ***\r\n"
                        );
                    }
                    socket.on("data", function (data) {
                        logger.debug("Socket ID::" + socket.id + "on data::");
                        logger.debug(data);
                        stream.write(data);
                    });
                    stream
                        .on("data", function (d) {
                            logger.debug(
                                "Socket ID::" + socket.id + " ssh stream on data ::"
                            );
                            logger.debug(utf8.decode(d.toString("binary")));
                            socket.emit("data", utf8.decode(d.toString("binary")));
                        })
                        .stderr.on("data", (d) => {
                            logger.debug(
                                "Socket ID::" + socket.id + " ssh error stream on data ::"
                            );
                            logger.debug(utf8.decode(d.toString("binary")));
                            socket.emit("data", utf8.decode(d.toString("binary")));
                        })
                        .on("error", function (d) {
                            logger.debug("Socket ID::" + socket.id + " ssh on error ::");
                            logger.debug(utf8.decode(d.toString("binary")));
                            socket.emit("data", utf8.decode(d.toString("binary")));
                        })
                        .on("close", function () {
                            logger.debug(
                                "Socket ID::" +
                                socket.id +
                                " ssh stream on close() :: Going to call ssh.end()"
                            );
                            ssh.end();
                        });
                });
            })
            .on("close", function () {
                logger.debug(
                    "Socket ID::" +
                    socket.id +
                    " ssh on close() :: COMMAND EXECUTED"
                );
                socket.emit("data", "\r\n*** SSH CONNECTION CLOSED ***\r\n");
            })
            .on("error", function (err) {
                logger.debug(err);
                logger.debug(
                    "Socket ID::" +
                    socket.id +
                    " ssh on error ::SSH EXEC ERROR: " +
                    err.message
                );
                socket.emit(
                    "data",
                    "\r\n*** SSH EXEC ERROR: " + err.message + " ***\r\n"
                );
            })
            .connect({
                host: data.hostname,
                port: data.port,
                username: data.username,
                password: data.password,
            });
    }
});

// Start the HTTP server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
