// server.js
import 'dotenv/config.js';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import projectModel from './models/project.model.js';

import { generateResult } from './services/ai.service.js';
import userRoutes from './routes/user.routes.js'; 

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(express.json());

// Enable CORS for frontend
app.use(cors({
    origin: 'https://ai-developer-frontend.onrender.com', // frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

// Routes
app.use('/users', userRoutes); // e.g., register/login routes

// Create HTTP server
const server = http.createServer(app);

// Socket.io setup with CORS
const io = new Server(server, {
    cors: {
        origin: 'https://ai-developer-frontend.onrender.com',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Socket authentication middleware
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.split(' ')[1];
        const projectId = socket.handshake.query.projectId;

        if (!mongoose.Types.ObjectId.isValid(projectId)) {
            return next(new Error('Invalid projectId'));
        }

        socket.project = await projectModel.findById(projectId);

        if (!token) return next(new Error('Authentication error'));

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded) return next(new Error('Authentication error'));

        socket.user = decoded;
        next();
    } catch (error) {
        next(error);
    }
});

// Socket.io events
io.on('connection', socket => {
    socket.roomId = socket.project._id.toString();
    console.log('A user connected:', socket.user.email);

    socket.join(socket.roomId);

    // Handle project messages
    socket.on('project-message', async data => {
        const message = data.message;

        const aiIsPresentInMessage = message.includes('@ai');

        // Broadcast user message to room
        socket.broadcast.to(socket.roomId).emit('project-message', data);

        // Handle AI response
        if (aiIsPresentInMessage) {
            const prompt = message.replace('@ai', '');
            const result = await generateResult(prompt);

            io.to(socket.roomId).emit('project-message', {
                message: result,
                sender: {
                    _id: 'ai',
                    email: 'AI'
                }
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.user.email);
        socket.leave(socket.roomId);
    });
});

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => {
    console.log('MongoDB connected');
    server.listen(port, () => console.log(`Server running on port ${port}`));
})
.catch(err => console.error('MongoDB connection error:', err));
