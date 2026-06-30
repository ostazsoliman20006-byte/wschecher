require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// تحديد مسار Chrome
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

const bot = new Telegraf(process.env.BOT_TOKEN);
const SESSION_PATH = path.join(__dirname, 'session');

// متغيرات لتخزين حالة المستخدمين
const userStates = {};

// دالة لإنشاء عميل واتساب جديد مع إعدادات Puppeteer المحسنة
function createWhatsAppClient(sessionName) {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: sessionName,
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: true,
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--force-color-profile=srgb',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run',
        '--password-store=basic',
        '--use-gl=swiftshader',
        '--use-mock-keychain',
      ],
    },
  });
}

// بدء البوت
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  userStates[userId] = { step: 'idle' };
  await ctx.reply(
    `👋 أهلاً بك في بوت فحص واتساب!\n\n` +
    `📱 أرسل /pair لتسجيل الدخول عبر Pair Code.\n` +
    `✅ بعد التسجيل، أرسل الأرقام المراد فحصها (رقم واحد لكل سطر).\n\n` +
    `مثال للأرقام:\n` +
    `+966512345678\n` +
    `+971501234567`
  );
});

// أمر /pair
bot.command('pair', async (ctx) => {
  const userId = ctx.from.id;
  userStates[userId] = { step: 'waiting_phone' };
  await ctx.reply(
    `📱 أرسل رقم هاتفك مع رمز الدولة:\n` +
    `مثال: +966512345678\n\n` +
    `⚠️ تأكد من كتابة علامة + قبل الرقم`
  );
});

// استقبال الرسائل النصية
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  // إذا كان المستخدم في خطوة انتظار رقم الهاتف
  if (userStates[userId]?.step === 'waiting_phone') {
    const phone = text.trim();
    
    // التحقق من صحة الرقم (يجب أن يبدأ بـ + ويتكون من 10-15 رقم)
    if (!phone.match(/^\+\d{10,15}$/)) {
      return ctx.reply(
        '❌ الرقم غير صحيح. أرسل رقم مع رمز الدولة مثل:\n' +
        '+966512345678\n\n' +
        '⚠️ تأكد من:\n' +
        '• وجود علامة + في البداية\n' +
        '• رمز الدولة الصحيح\n' +
        '• عدم وجود مسافات أو أحرف'
      );
    }

    await ctx.reply(`⏳ جاري تسجيل الدخول عبر Pair Code للرقم: ${phone}`);

    // إنشاء عميل واتساب جديد
    const client = createWhatsAppClient(`user_${userId}`);

    // الاستماع لحدث ظهور الـ Pair Code
    client.on('pair_code', (pairCode) => {
      ctx.reply(
        `🔑 *كود الاقتران الخاص بك:*\n\n` +
        `📋 \`${pairCode}\`\n\n` +
        `📱 كيفية الاستخدام:\n` +
        `1. افتح واتساب على هاتفك\n` +
        `2. اذهب إلى الإعدادات > الأجهزة المرتبطة\n` +
        `3. اضغط على ربط جهاز\n` +
        `4. أدخل الكود أعلاه\n\n` +
        `⏳ بعد إدخال الكود، انتظر حتى يتم التأكيد...`
      );
    });

    // حدث نجاح المصادقة
    client.on('authenticated', (session) => {
      console.log('✅ تمت المصادقة بنجاح للمستخدم:', userId);
    });

    // حدث فشل المصادقة
    client.on('auth_failure', (msg) => {
      ctx.reply('❌ فشل المصادقة: ' + msg + '\n\nيرجى المحاولة مرة أخرى باستخدام /pair');
      delete userStates[userId];
    });

    // حدث جاهزية العميل
    client.on('ready', () => {
      ctx.reply(
        '✅ *تم تسجيل الدخول بنجاح!*\n\n' +
        '📊 يمكنك الآن إرسال الأرقام للفحص.\n' +
        '📝 أرسل رقم واحد لكل سطر.'
      );
      userStates[userId].client = client;
      userStates[userId].step = 'ready';
    });

    // حدث قطع الاتصال
    client.on('disconnected', (reason) => {
      console.log('⚠️ تم قطع الاتصال للمستخدم:', userId, reason);
      ctx.reply('⚠️ تم قطع الاتصال. استخدم /pair لإعادة التسجيل.');
      if (userStates[userId]) {
        delete userStates[userId];
      }
    });

    // بدء العميل
    try {
      await client.initialize();
    } catch (err) {
      console.error('❌ خطأ في تهيئة العميل:', err);
      ctx.reply(
        '❌ *حدث خطأ أثناء تهيئة العميل.*\n\n' +
        'الأسباب المحتملة:\n' +
        '• مشكلة في الاتصال بالإنترنت\n' +
        '• الرقم غير صحيح\n' +
        '• تم استخدام الرقم من قبل\n\n' +
        '🔄 حاول مرة أخرى باستخدام /pair'
      );
      delete userStates[userId];
    }
    return;
  }

  // إذا كان المستخدم جاهزًا للفحص
  if (userStates[userId]?.step === 'ready') {
    const client = userStates[userId].client;
    if (!client) {
      await ctx.reply('❌ يرجى تسجيل الدخول أولاً باستخدام /pair');
      delete userStates[userId];
      return;
    }

    // تقسيم النص إلى أرقام
    const numbers = text.split('\n')
      .map(n => n.trim())
      .filter(n => n.length > 0);

    if (numbers.length === 0) {
      return ctx.reply('❌ لم يتم إرسال أي أرقام.');
    }

    // التحقق من صحة الأرقام
    const invalidNumbers = numbers.filter(n => !n.match(/^\+\d{10,15}$/));
    if (invalidNumbers.length > 0) {
      return ctx.reply(
        '❌ الأرقام التالية غير صحيحة:\n' +
        invalidNumbers.join('\n') +
        '\n\n⚠️ يجب أن تكون الأرقام بصيغة: +966512345678'
      );
    }

    await ctx.reply(`⏳ جاري فحص ${numbers.length} رقم... قد يستغرق ذلك بضع ثوان.`);

    let results = [];
    let checked = 0;
    
    for (let num of numbers) {
      try {
        const cleanNum = num.replace(/\s/g, '');
        const isRegistered = await client.isRegisteredUser(cleanNum);
        results.push(`${cleanNum}: ${isRegistered ? '✅ مسجل' : '❌ غير مسجل'}`);
        checked++;
        
        // تحديث التقدم كل 5 أرقام
        if (checked % 5 === 0) {
          await ctx.reply(`⏳ تم فحص ${checked} من ${numbers.length} رقم...`);
        }
      } catch (err) {
        console.error('خطأ في فحص الرقم:', num, err);
        results.push(`${num}: ⚠️ خطأ في الفحص`);
      }
    }

    // إرسال النتائج النهائية
    const resultMessage = 
      `📊 *نتائج الفحص:*\n\n` +
      `${results.join('\n')}\n\n` +
      `📈 تم فحص ${results.length} رقم بنجاح.`;
    
    await ctx.reply(resultMessage);
  } else {
    await ctx.reply(
      `👋 مرحباً!\n\n` +
      `📱 استخدم /pair لتسجيل الدخول أولاً.\n` +
      `✅ بعد ذلك أرسل الأرقام للفحص (رقم لكل سطر).\n\n` +
      `مثال:\n` +
      `+966512345678\n` +
      `+971501234567`
    );
  }
});

// تشغيل البوت
bot.launch().then(() => {
  console.log('✅ بوت تيليجرام يعمل...');
  console.log('📱 انتظر تسجيل الدخول عبر Pair Code');
});

// إيقاف التشغيل بشكل آمن
process.once('SIGINT', () => {
  console.log('🛑 إيقاف البوت...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 إيقاف البوت...');
  bot.stop('SIGTERM');
});

// معالجة الأخطاء غير المتوقعة
process.on('unhandledRejection', (error) => {
  console.error('❌ خطأ غير متوقع:', error);
});
