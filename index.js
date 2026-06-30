require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const SESSION_PATH = path.join(__dirname, 'session');

// متغيرات لتخزين حالة المستخدمين
const userStates = {};

// دالة لإنشاء عميل واتساب جديد
function createWhatsAppClient(sessionName) {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: sessionName,
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });
}

// بدء البوت
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  userStates[userId] = { step: 'idle' };
  await ctx.reply(
    `👋 أهلاً بك في بوت فحص واتساب!\n\n` +
    `أرسل /pair لتسجيل الدخول عبر Pair Code.\n` +
    `بعد التسجيل، أرسل الأرقام المراد فحصها (رقم واحد لكل سطر).`
  );
});

// أمر /pair
bot.command('pair', async (ctx) => {
  const userId = ctx.from.id;
  userStates[userId] = { step: 'waiting_phone' };
  await ctx.reply(
    `📱 أرسل رقم هاتفك مع رمز الدولة:\n` +
    `مثال: +966512345678`
  );
});

// استقبال الرسائل النصية
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  // إذا كان المستخدم في خطوة انتظار رقم الهاتف
  if (userStates[userId]?.step === 'waiting_phone') {
    const phone = text.trim();
    if (!phone.match(/^\+\d{10,15}$/)) {
      return ctx.reply('❌ الرقم غير صحيح. أرسل رقم مع رمز الدولة مثل: +966512345678');
    }

    await ctx.reply(`⏳ جاري تسجيل الدخول عبر Pair Code للرقم: ${phone}`);

    // إنشاء عميل واتساب جديد
    const client = createWhatsAppClient(`user_${userId}`);

    // الاستماع لحدث ظهور الـ Pair Code
    client.on('authenticated', (session) => {
      // لا نستخدم QR Code
    });

    client.on('auth_failure', (msg) => {
      ctx.reply('❌ فشل المصادقة: ' + msg);
    });

    client.on('ready', () => {
      ctx.reply('✅ تم تسجيل الدخول بنجاح! يمكنك الآن إرسال الأرقام للفحص.');
      userStates[userId].client = client;
      userStates[userId].step = 'ready';
    });

    client.on('disconnected', (reason) => {
      ctx.reply('⚠️ تم قطع الاتصال: ' + reason);
      delete userStates[userId];
    });

    // حدث ظهور Pair Code
    client.on('pair_code', (pairCode) => {
      ctx.reply(
        `🔑 كود الاقتران الخاص بك:\n\n` +
        `*${pairCode}*\n\n` +
        `افتح واتساب على هاتفك > الإعدادات > الأجهزة المرتبطة > ربط جهاز > أدخل هذا الرمز.`
      );
    });

    // بدء العميل
    try {
      await client.initialize();
    } catch (err) {
      console.error(err);
      ctx.reply('❌ حدث خطأ أثناء تهيئة العميل.');
    }
    return;
  }

  // إذا كان المستخدم جاهزًا للفحص
  if (userStates[userId]?.step === 'ready') {
    const client = userStates[userId].client;
    if (!client) {
      return ctx.reply('❌ يرجى تسجيل الدخول أولاً باستخدام /pair');
    }

    const numbers = text.split('\n').map(n => n.trim()).filter(n => n.length > 0);
    if (numbers.length === 0) {
      return ctx.reply('❌ لم يتم إرسال أي أرقام.');
    }

    await ctx.reply(`⏳ جاري فحص ${numbers.length} رقم... قد يستغرق ذلك بضع ثوان.`);

    let results = [];
    for (let num of numbers) {
      try {
        // إزالة أي مسافات أو أحرف غير مرغوب فيها
        const cleanNum = num.replace(/\s/g, '');
        const isRegistered = await client.isRegisteredUser(cleanNum);
        results.push(`${cleanNum}: ${isRegistered ? '✅ مسجل' : '❌ غير مسجل'}`);
      } catch (err) {
        results.push(`${num}: ⚠️ خطأ في الفحص`);
      }
    }

    await ctx.reply(`📊 *نتائج الفحص:*\n\n${results.join('\n')}`);
  } else {
    await ctx.reply(
      `👋 استخدم /pair لتسجيل الدخول أولاً.\n` +
      `بعد ذلك أرسل الأرقام للفحص (رقم لكل سطر).`
    );
  }
});

// تشغيل البوت
bot.launch().then(() => {
  console.log('✅ بوت تيليجرام يعمل...');
});

// إيقاف التشغيل بشكل آمن
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
