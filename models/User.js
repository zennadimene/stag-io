const db = require('../config/database');

class User {
    static async create({ email, password, user_type, verification_token }) {
        const [result] = await db.execute(
            'INSERT INTO users (email, password, user_type, verification_token) VALUES (?, ?, ?, ?)',
            [email, password, user_type, verification_token]
        );
        return result.insertId;
    }

    static async findByEmail(email) {
        const [rows] = await db.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        return rows[0];
    }

    static async findById(id) {
        const [rows] = await db.execute(
            'SELECT * FROM users WHERE id = ?',
            [id]
        );
        return rows[0];
    }

    static async verifyEmail(token) {
        const [result] = await db.execute(
            'UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE verification_token = ?',
            [token]
        );
        return result.affectedRows > 0;
    }

    static async updatePassword(id, password) {
        const [result] = await db.execute(
            'UPDATE users SET password = ? WHERE id = ?',
            [password, id]
        );
        return result.affectedRows > 0;
    }

    static async setResetToken(email, token, expiry) {
        const [result] = await db.execute(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE email = ?',
            [token, expiry, email]
        );
        return result.affectedRows > 0;
    }

    static async verifyResetToken(token) {
        const [rows] = await db.execute(
            'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
            [token]
        );
        return rows[0];
    }

    static async clearResetToken(token) {
        await db.execute(
            'UPDATE users SET reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = ?',
            [token]
        );
    }



    static async findAdmin() {
        const [rows] = await db.execute(
            "SELECT * FROM users WHERE user_type = 'admin' LIMIT 1"
        );
        return rows[0];
    }
    
    static async createAdmin({ email, password }) {
        const [result] = await db.execute(
            'INSERT INTO users (email, password, user_type, is_verified) VALUES (?, ?, ?, ?)',
            [email, password, 'admin', 1]
        );
        return result.insertId;
    }
}
module.exports = User;