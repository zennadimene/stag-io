const db = require('../config/database');

class Company {
    static async create(companyData) {
        const {
            user_id,
            company_name,
            company_email,
            phone,
            website,
            trade_register,
            activity_sector,
            company_size,
            wilaya,
            address,
            contact_person,
            position,
            personal_email,
            description,
            logo_url
        } = companyData;

        const [result] = await db.execute(
            `INSERT INTO companies (
                user_id, company_name, company_email, phone, website,
                trade_register, activity_sector, company_size, wilaya,
                address, contact_person, position, personal_email,
                description, logo_url, profile_completed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [
                user_id, company_name, company_email, phone, website,
                trade_register, activity_sector, company_size, wilaya,
                address, contact_person, position, personal_email,
                description, logo_url
            ]
        );
        return result.insertId;
    }

    static async findByUserId(user_id) {
        const [rows] = await db.execute(
            'SELECT * FROM companies WHERE user_id = ?',
            [user_id]
        );
        return rows[0];
    }

    static async updateProfile(user_id, updates) {
        const fields = [];
        const values = [];
        
        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }
        
        if (fields.length === 0) return false;
        
        values.push(user_id);
        const query = `UPDATE companies SET ${fields.join(', ')} WHERE user_id = ?`;
        
        const [result] = await db.execute(query, values);
        return result.affectedRows > 0;
    }

    static async verifyCompany(company_id) {
        const [result] = await db.execute(
            'UPDATE companies SET is_verified = TRUE WHERE id = ?',
            [company_id]
        );
        return result.affectedRows > 0;
    }
}

module.exports = Company;