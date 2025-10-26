const { signUpUser, signInUser } = require('../models/userModel');

const signup = async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const user = await signUpUser(name, email, password);
    return res.status(201).json({ message: 'Signup successful', user });
  } catch (error) {
    const msg = error.message || 'Signup failed';
    // map some common messages to appropriate status codes
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
      return res.status(409).json({ error: msg });
    }
    if (msg.toLowerCase().includes('invalid email') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('password')) {
      return res.status(422).json({ error: msg });
    }

    return res.status(400).json({ error: msg });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const session = await signInUser(email, password);
    res.status(200).json({ message: 'Login successful', session });
  } catch (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('not confirmed') || msg.includes('verify your email')) {
      return res.status(403).json({ error: error.message, code: 'email_not_confirmed' });
    }
    if (msg.includes('invalid email or password') || msg.includes('invalid login')) {
      return res.status(401).json({ error: 'Invalid email or password', code: 'invalid_credentials' });
    }
    return res.status(400).json({ error: error.message || 'Login failed' });
  }
};

module.exports = {
  signup,
  login,
};
