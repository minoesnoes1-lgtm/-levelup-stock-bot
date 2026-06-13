require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const MONITOR_URL = process.env.MONITOR_URL;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 300000; // 5 minuten
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

// Slaat producten op voor vergelijking
let knownProducts = loadProducts();
let monitoringUsers = new Set();

// Laad opgeslagen producten
function loadProducts() {
  try {
    if (fs.existsSync(PRODUCTS_FILE)) {
      return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading products:', error);
  }
  return [];
}

// Slaag producten op
function saveProducts() {
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(knownProducts, null, 2));
  } catch (error) {
    console.error('Error saving products:', error);
  }
}

// Scrape de website
async function scrapeProducts() {
  try {
    const response = await axios.get(MONITOR_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const products = [];

    // Pas de selector aan gebaseerd op de website structuur
    $('.product-item, .product, [class*="product"]').each((index, element) => {
      const name = $(element).find('h2, .product-name, [class*="name"]').text().trim();
      const price = $(element).find('.price, [class*="price"]').text().trim();
      const productUrl = $(element).find('a').attr('href');
      const image = $(element).find('img').attr('src');

      if (name && price) {
        products.push({
          name,
          price,
          url: productUrl ? (productUrl.startsWith('http') ? productUrl : MONITOR_URL.split('/special-boxen')[0] + productUrl) : MONITOR_URL,
          image,
          timestamp: new Date().toISOString()
        });
      }
    });

    return products;
  } catch (error) {
    console.error('Error scraping website:', error.message);
    return [];
  }
}

// Vergelijk producten en vind nieuwkomers
function findNewProducts(currentProducts) {
  const newProducts = currentProducts.filter(current => 
    !knownProducts.some(known => known.name === current.name)
  );
  return newProducts;
}

// Stuur notificatie naar alle users
async function notifyUsers(message, products) {
  for (const userId of monitoringUsers) {
    try {
      await bot.sendMessage(userId, message);
      
      // Stuur productdetails
      for (const product of products) {
        const productMessage = 
          `🆕 *Nieuw product gevonden!*\n\n` +
          `📦 *${product.name}*\n` +
          `💰 ${product.price}\n` +
          `🔗 [Bekijk product](${product.url})`;
        
        await bot.sendMessage(userId, productMessage, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error(`Error sending message to user ${userId}:`, error);
    }
  }
}

// Monitor loop
async function monitorWebsite() {
  console.log(`[${new Date().toLocaleString()}] Checking for new products...`);
  
  const currentProducts = await scrapeProducts();
  
  if (currentProducts.length > 0) {
    const newProducts = findNewProducts(currentProducts);
    
    if (newProducts.length > 0) {
      console.log(`Found ${newProducts.length} new products!`);
      knownProducts = currentProducts;
      saveProducts();
      
      await notifyUsers(
        `⚠️ *${newProducts.length} nieuwe Pokemon TCG Special Boxen gevonden!*`,
        newProducts
      );
    }
  }
}

// Start monitoring bij /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  monitoringUsers.add(chatId);
  
  bot.sendMessage(
    chatId,
    `🤖 *Pokemon TCG Monitor Bot*\n\n` +
    `Ik ga de website monitoren op nieuwe producten.\n` +
    `Je wordt gewaarschuwd wanneer er nieuwe Special Boxen beschikbaar zijn!\n\n` +
    `Commands:\n` +
    `/status - Huidige status\n` +
    `/stop - Stop monitoring\n` +
    `/products - Toon huidige producten`,
    { parse_mode: 'Markdown' }
  );
});

// Stop monitoring
bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  monitoringUsers.delete(chatId);
  bot.sendMessage(chatId, '❌ Monitoring gestopt. Tot ziens!');
});

// Toon status
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const isMonitoring = monitoringUsers.has(chatId);
  const productCount = knownProducts.length;
  
  bot.sendMessage(
    chatId,
    `📊 *Status*\n\n` +
    `Monitoring: ${isMonitoring ? '✅ AAN' : '❌ UIT'}\n` +
    `Actieve monitors: ${monitoringUsers.size}\n` +
    `Gekende producten: ${productCount}\n` +
    `Check interval: ${CHECK_INTERVAL / 1000} seconden`,
    { parse_mode: 'Markdown' }
  );
});

// Toon alle producten
bot.onText(/\/products/, (msg) => {
  const chatId = msg.chat.id;
  
  if (knownProducts.length === 0) {
    bot.sendMessage(chatId, '📦 Nog geen producten gevonden. Check later opnieuw!');
    return;
  }
  
  let productList = `📦 *Huidige producten (${knownProducts.length})*\n\n`;
  knownProducts.slice(0, 10).forEach((product, index) => {
    productList += `${index + 1}. ${product.name}\n${product.price}\n\n`;
  });
  
  if (knownProducts.length > 10) {
    productList += `... en ${knownProducts.length - 10} meer`;
  }
  
  bot.sendMessage(chatId, productList, { parse_mode: 'Markdown' });
});

// Help commando
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `🆘 *Beschikbare Commands*\n\n` +
    `/start - Begin monitoring\n` +
    `/stop - Stop monitoring\n` +
    `/status - Toon status\n` +
    `/products - Toon alle producten\n` +
    `/help - Dit bericht`,
    { parse_mode: 'Markdown' }
  );
});

// Onbekende berichten
bot.on('message', (msg) => {
  if (!msg.text.startsWith('/')) {
    bot.sendMessage(msg.chat.id, 'Gebruik /help voor beschikbare commands');
  }
});

// Start monitoring
console.log('🚀 Pokemon TCG Monitor Bot gestart!');
monitorWebsite(); // First check
setInterval(monitorWebsite, CHECK_INTERVAL);

console.log('⏱️ Monitoring interval:', CHECK_INTERVAL / 1000, 'seconden');
