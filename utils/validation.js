const validator = require('validator');

const validateStudentRegistration = (data) => {
    const errors = {};

    // Required fields
    if (!data.first_name?.trim()) errors.first_name = 'First name is required';
    if (!data.last_name?.trim()) errors.last_name = 'Last name is required';
    
    if (!data.university_email?.trim()) {
        errors.university_email = 'University email is required';
    } else if (!validator.isEmail(data.university_email)) {
        errors.university_email = 'Invalid email format';
    } else {
        const algerianUniversityRegex = /^[a-zA-Z]+\.[a-zA-Z]+@univ-[a-zA-Z]+[0-9]*\.dz$/;
        if (!algerianUniversityRegex.test(data.university_email)) {
            errors.university_email = 'Email must be in format: firstname.lastname@univ-[university].dz (Example: imene.zennad@univ-constantine2.dz)';
        }
    }

    if (!data.university?.trim()) errors.university = 'University is required';
    if (!data.specialization?.trim()) errors.specialization = 'Specialization is required';
    if (!data.year_of_study?.trim()) errors.year_of_study = 'Year of study is required';
    
    if (!data.password?.trim()) {
        errors.password = 'Password is required';
    } else if (data.password.length < 8) {
        errors.password = 'Password must be at least 8 characters';
    }

    if (data.password !== data.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
    }

    // Optional validations
    if (data.phone && !validator.isMobilePhone(data.phone, 'any')) {
        errors.phone = 'Invalid phone number';
    }

    if (data.github_link && !validator.isURL(data.github_link)) {
        errors.github_link = 'Invalid URL';
    }

    if (data.linkedin_link && !validator.isURL(data.linkedin_link)) {
        errors.linkedin_link = 'Invalid URL';
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
};



const validateCompanyRegistration = (data) => {
    const errors = {};

    // Required fields
    if (!data.company_name?.trim()) errors.company_name = 'Company name is required';
    
    if (!data.company_email?.trim()) {
        errors.company_email = 'Company email is required';
    } else if (!validator.isEmail(data.company_email)) {
        errors.company_email = 'Invalid email format';
    }

    if (!data.phone?.trim()) errors.phone = 'Phone number is required';
    if (!data.trade_register?.trim()) errors.trade_register = 'Trade register is required';
    if (!data.activity_sector?.trim()) errors.activity_sector = 'Activity sector is required';
    if (!data.wilaya?.trim()) errors.wilaya = 'Wilaya is required';
    if (!data.contact_person?.trim()) errors.contact_person = 'Contact person is required';
    if (!data.position?.trim()) errors.position = 'Position is required';
    
    if (!data.password?.trim()) {
        errors.password = 'Password is required';
    } else if (data.password.length < 8) {
        errors.password = 'Password must be at least 8 characters';
    }

    if (data.password !== data.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
    }

    // Optional validations
    if (data.website && !validator.isURL(data.website)) {
        errors.website = 'Invalid URL';
    }

    if (data.personal_email && !validator.isEmail(data.personal_email)) {
        errors.personal_email = 'Invalid email format';
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
};

const validateLogin = (data) => {
    const errors = {};

    if (!data.email?.trim()) {
        errors.email = 'Email is required';
    } else if (!validator.isEmail(data.email)) {
        errors.email = 'Invalid email format';
    }

    if (!data.password?.trim()) {
        errors.password = 'Password is required';
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
};

module.exports = {
    validateStudentRegistration,
    validateCompanyRegistration,
    validateLogin
};