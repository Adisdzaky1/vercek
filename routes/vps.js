const express = require('express');
const Docker = require('dockerode');
const { Client } = require('pg'); // Import pg module
const router = express.Router();
const docker = new Docker();
const fs = require('fs');
const pg = require('pg');
const url = require('url');
const fetch = require('node-fetch');

// Database configuration
const connectionString = 'postgresql://postgres.uuqfnngkeheonzancwlt:Asep@@12344@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';

// Buat Pool untuk koneksi database
const client = new pg.Client({
    connectionString,
    ssl: {
        rejectUnauthorized: false // Atur SSL jika diperlukan
    },
});


client.connect();


// Helper function to find an available port
async function findAvailablePort(start = 20000, end = 30000) {
    return new Promise((resolve) => {
        const port = Math.floor(Math.random() * (end - start + 1)) + start;
        const server = require('net').createServer();

        server.listen(port, () => {
            server.close(() => resolve(port));
        });

        server.on('error', async () => {
            resolve(await findAvailablePort(start, end));
        });
    });
}

// Fetch users data from PostgreSQL
const getUsersData = async () => {
    try {
        const res = await client.query('SELECT * FROM users');
        console.log('Fetched users data:', res.rows); // Debug log
        return res.rows.map(user => ({
            ...user,
            vps: user.vps ? JSON.parse(user.vps) : null,
        }));
    } catch (err) {
        console.error('Error fetching users:', err);
        return [];
    }
};

// Save updated users data to PostgreSQL
const saveUsersData = async (users) => {
    try {
        for (const user of users) {
            console.log('Saving user:', user.username, 'VPS:', JSON.stringify(user.vps)); // Debug log
            const result = await client.query(
                'UPDATE users SET vps = $1 WHERE username = $2',
                [JSON.stringify(user.vps), user.username]
            );
            if (result.rowCount === 0) {
                console.error('Failed to update VPS data for:', user.username);
            }
        }
    } catch (err) {
        console.error('Error saving users:', err);
    }
};

// Function to check if a container with the same name exists
async function isContainerNameExists(vpsName) {
    const containers = await docker.listContainers({ all: true });
    return containers.some(container => container.Names.includes(`/${vpsName}`));
}

// 1. Create VPS
router.post('/create', async (req, res) => {
    try {
        const { vpsName, password } = req.body;
        const port = await findAvailablePort();
        const { username } = req.session.user;

        const response = await fetch('https://ip-json.vercel.app/');
        const json = await response.json();
        const ip = json.result.query;

        let containerName = vpsName;
        let containerExists = await isContainerNameExists(containerName);

        if (containerExists) {
            containerName = `${vpsName}-${Math.floor(Math.random() * 1000)}`;
        }

        const container = await docker.createContainer({
            Image: 'vps-image',
            Hostname: username,
            name: containerName,
            Tty: true,
            HostConfig: {
                PortBindings: {
                    "22/tcp": [{ HostPort: `${port}`, HostIp: ip }],
                },
                Memory: 512 * 1024 * 1024,
                NanoCPUs: 1 * 1e9,
            },
        });

        await container.start();

        const exec = await container.exec({
            Cmd: [`bash`, `-c`, `echo "root:${password}" | chpasswd`],
            AttachStdout: true,
            AttachStderr: true,
        });

        await exec.start({ Detach: false });

        const users = await getUsersData();
        let existingUser = users.find(user => user.username === username);

        if (existingUser) {
            existingUser.vps = {
                name: containerName,
                containerId: container.id,
                status: "ON",
                ip,
                username: "root",
                password,
                port,
            };

            await saveUsersData(users);

            req.session.user.vps = existingUser.vps; // Update session

            res.status(201).json({
                message: 'VPS created successfully',
                ip,
                username: "root",
                status: "ON",
                vpsName: containerName,
                port,
                password,
            });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create VPS' });
    }
});

// 2. Stop VPS
router.post('/stop', async (req, res) => {
    try {
        const { containerId } = req.body;
        const { username } = req.session.user;
        const users = await getUsersData();
        let existingUser = users.find(user => user.username === username);

        if (!existingUser || !existingUser.vps) {
            return res.status(404).json({ error: 'VPS not found for the user' });
        }

        const container = docker.getContainer(containerId);
        await container.stop();

        existingUser.vps.status = "OFF";
        await saveUsersData(users);

        req.session.user.vps = existingUser.vps; // Update session
        console.log('Updated VPS status to OFF:', existingUser.vps);

        res.status(200).json({ message: 'VPS stopped successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to stop VPS' });
    }
});

// 3. Delete VPS
router.post('/delete', async (req, res) => {
    try {
        const { containerId } = req.body;
        const { username } = req.session.user;
        const users = await getUsersData();
        let existingUser = users.find(user => user.username === username);

        if (!existingUser || !existingUser.vps) {
            return res.status(404).json({ error: 'VPS not found for the user' });
        }

        const container = docker.getContainer(containerId);

        try {
            await container.stop();
        } catch (error) {
            console.warn('Container not running, skipping stop:', error.message);
        }

        await container.remove();

        existingUser.vps = null;
        await saveUsersData(users);

        req.session.user.vps = null; // Update session
        
        res.status(200).json({ message: 'VPS deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete VPS', details: error.message });
    }
});


// 3. Start VPS
router.post('/start', async (req, res) => {
    try {
        const { containerId } = req.body;
        const { username } = req.session.user;
        const users = await getUsersData();
        let existingUser = users.find(user => user.username === username);
       console.log(users)
        if (!existingUser || !existingUser.vps) {
            return res.status(404).json({ error: 'VPS not found for the user' });
        }

        const container = docker.getContainer(containerId);
        await container.start();

        existingUser.vps.status = "ON";
        
        await saveUsersData(users); // Save the updated user data
        req.session.user.vps.status = existingUser.vps.status; // Update session
        res.status(200).json({ message: 'VPS started successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to start VPS' });
    }
});


// 5. Reset Password
router.post('/reset-password', async (req, res) => {
    try {
        const { containerId, newPassword } = req.body;
        const container = docker.getContainer(containerId);

        // Run command inside container to reset password
        await container.exec({
            Cmd: [`bash`, `-c`, `echo "root:${newPassword}" | chpasswd`],
            AttachStdout: true,
            AttachStderr: true
        });

        res.status(200).json({ message: 'Password reset successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});


// 6. Check Resource Usage
router.get('/usage/:containerId', async (req, res) => {
  try {
    const { containerId } = req.params;
    const container = docker.getContainer(containerId);

    // Mengambil stats dari container
    const stats = await container.stats({ stream: false });

    // Mengambil disk usage melalui docker inspect
    const containerInspect = await container.inspect();
    const diskUsed = containerInspect.SizeRootFs; // Ukuran disk yang digunakan oleh root filesystem container
    const containerSize = containerInspect.SizeRw; // Ukuran writable layer dari container
console.log(diskUsed)
    // Data CPU dan Memori
    const cpuUsagePercentage = calculateCpuUsagePercentage(stats);
    const memoryUsage = stats.memory_stats.usage;
    const memoryLimit = stats.memory_stats.limit;

    // Mengirimkan response dengan data CPU, Memori, dan Disk Usage
    res.status(200).json({
      cpuUsage: `${cpuUsagePercentage.toFixed(2)}%`, // CPU usage dalam persen
      memoryUsage: formatBytes(memoryUsage), // Penggunaan memori
      memoryLimit: formatBytes(memoryLimit), // Batas memori
      diskUsed: formatBytes(diskUsed), // Ukuran disk yang digunakan oleh root filesystem
      containerSize: formatBytes(containerSize) // Ukuran writable layer dari container
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch resource usage' });
  }
});


module.exports = router;
// Fungsi untuk memformat bytes ke MB, GB, dll.
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

// Fungsi untuk menghitung persentase CPU
const calculateCpuUsagePercentage = (cpuStats) => {
  if (!cpuStats || !cpuStats.cpu_usage || !cpuStats.precpu_stats) {
    return 0;
  }

  const cpuDelta = cpuStats.cpu_usage.total_usage - cpuStats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = cpuStats.system_cpu_usage - cpuStats.precpu_stats.system_cpu_usage;
  if (systemDelta > 0 && cpuDelta > 0) {
    return (cpuDelta / systemDelta) * cpuStats.cpu_usage.percpu_usage.length * 100;
  }
  return 0;
};
