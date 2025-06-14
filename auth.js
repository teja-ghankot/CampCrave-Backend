const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

app.use(cors());
app.use(bodyParser.json());

app.use((req, res, next) => {
  req.io = io;
  next();
});

mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://teja:teja2005@cluster0.yccd7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const menuItemSchema = new mongoose.Schema({
  name: String,
  category: String,
  price: Number,
  availability: Boolean,
  quantity: Number,
});
const MenuItem = mongoose.model('MenuItem', menuItemSchema);

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'student' },
  wallet:{ type: Number, default: 0 }, // Add wallet field
});
const User = mongoose.model('User', userSchema);

const orderSchema = new mongoose.Schema({
  customerName: String,
  items: [String],
  total: Number,
  deliveryLocation: String,
  status: { type: String, enum: ['Preparing', 'Ready', 'Pickup'], default: 'Preparing' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  // Reference to user
  orderDate: { type: Date, default: Date.now },
});

const Order = mongoose.model('Order', orderSchema);
app.post('/register', async (req, res) => {
  const { phone, email, password, role } = req.body;
  if (!phone || !email || !password) return res.status(400).json({ message: 'All fields are required.' });
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'User already exists.' });
    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({ phone, email, password: hashed, role });
    await newUser.save();
    const token = jwt.sign({ id: newUser._id, role: newUser.role }, JWT_SECRET, { expiresIn: '1h' });
    res.status(201).json({ message: 'Registered', token:token , phonenumber : phone});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/login', async (req, res) => {
  const { mobileNumber, password } = req.body;
  if (!mobileNumber || !password) return res.status(400).json({ message: 'All fields are required.' });
  try {
    const user = await User.findOne({ phone: mobileNumber });
    if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials.' });
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ message: 'Login successful', token, role: user.role ,  userId: user._id , phonenumber: mobileNumber});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/menu', async (req, res) => {
  try {
    const items = await MenuItem.find();
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load menu' });
  }
});

app.get('/menu/available', async (req, res) => {
  try {
    const available = await MenuItem.find({ availability: true });
    res.json(available);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch available items' });
  }
});
app.patch('/menu/availability', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'No items provided.' });
  }
  try {
    await MenuItem.updateMany({}, { $set: { availability: false, quantity: 0 } });

    const updatedDocs = [];
    for (const item of items) {
      const updated = await MenuItem.findOneAndUpdate(
        { name: item.name },
        { $set: { availability: true, quantity: item.quantity } },
        { new: true }
      );
      if (updated) updatedDocs.push(updated);
    }


    req.io.emit('menu-updated', updatedDocs);

    res.status(200).json({ message: 'Menu updated successfully.', updated: updatedDocs });
  } catch (err) {
    console.error('Error updating availability:', err);
    res.status(500).json({ message: 'Failed to update availability' });
  }
});

app.get('/orders/history', async (req, res) => {
  const { userId } = req.query;

  if (!userId) return res.status(400).json({ message: 'User ID is required.' });

  try {

    const orders = await Order.find({ userId }).sort({ orderDate: -1 });

    if (orders.length === 0) {
      return res.status(404).json({ message: 'No orders found for this user.' });
    }

    res.status(200).json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// Orders endpoints...
app.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find();
    res.status(200).json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/orders', async (req, res) => {
  const { customerName, items, total, deliveryLocation, userId } = req.body;

  try {
    // Check availability
    const menuItems = await MenuItem.find({ name: { $in: items } });

    for (const item of items) {
      const menuItem = menuItems.find(m => m.name === item);
      if (!menuItem || menuItem.quantity <= 0) {
        return res.status(400).json({ error: `${item} is out of stock.` });
      }
    }

    // Decrease quantities
    for (const item of items) {
      
      const updatedItem = await MenuItem.findOneAndUpdate(
        { name: item },
        { $inc: { quantity: -1 } },
        { new: true }
      );
    
        // If quantity is now 0 or less, mark as unavailable
    if (updatedItem.quantity <= 0 && updatedItem.availability !== false) {
      updatedItem.availability = false;
      await updatedItem.save();
      
    }
  }

    // Save order
    const newOrder = new Order({ customerName, items, total, deliveryLocation, userId });
    await newOrder.save();

    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.status(200).json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

app.post('/wallet/add', async (req, res) => {
  try {
    const { userId, amount } = req.body;

    // Basic validation
    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'userId and amount are required'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Find user and update wallet
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { wallet: amount } }, // Increment wallet by amount
      { new: true } // Return updated document
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Wallet updated successfully',
      data: {
        userId: user._id,
        newBalance: user.wallet,
        amountAdded: amount
      }
    });

  } catch (error) {
    console.error('Wallet update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});
app.get('/wallet', async (req, res) => {
  try {
    const { userId } = req.query;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        data: null
      });
    }

    // Find user and get wallet balance
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    // Return wallet balance
    // Assuming wallet balance is stored in user.walletBalance field
    const balance = user.wallet || 0;

    return res.status(200).json({
      success: true,
      message: 'Wallet balance fetched successfully',
      data: {
        balance: balance,
        userId: userId
      }
    });

  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: null
    });
  }
});
app.post('/wallet/deduct', async (req, res) => {
  try {
    const { userId, amount } = req.body;

    // Basic validation
    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'userId and amount are required'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

  
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }


    if (user.wallet < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance',
        data: {
          currentBalance: user.wallet,
          requestedAmount: amount
        }
      });
    }


    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { wallet: -amount } }, 
      { new: true } 
    );

    res.status(200).json({
      success: true,
      message: 'Wallet updated successfully',
      data: {
        userId: updatedUser._id,
        newBalance: updatedUser.wallet,
        amountDeducted: amount
      }
    });

  } catch (error) {
    console.error('Wallet deduct error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Socket.IO connection handler
io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});
