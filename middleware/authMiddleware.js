
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ 
            success: false,
            message: 'Please login to access' 
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key');
        
        const [users] = await db.execute(
            'SELECT id, is_suspended, user_type FROM users WHERE id = ?',
            [decoded.id]
        );
        
        if (users.length === 0) {
            return res.status(401).json({ 
                success: false,
                message: 'User not found' 
            });
        }
        
        if (users[0].is_suspended === 1) {
            return res.status(403).json({ 
                success: false,
                message: 'Your account has been suspended. Please contact administrator.' 
            });
        }
        
        req.user = {
            id: decoded.id,
            email: decoded.email,
            user_type: decoded.user_type
        };
        
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(401).json({ 
            success: false,
            message: 'Token is invalid or expired' 
        });
    }
};

module.exports = { protect };