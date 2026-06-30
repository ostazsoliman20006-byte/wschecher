const { Telegraf, Markup } = require('telegraf');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const express = require('express');
const fs = require('fs');

// إعداد سرفر ويب بسيط لمنع منصة Render من إغلاق البوت
const app = express();
app.get('/', (req, res) => res.send('WS Checker Multi-Account is Running!'));
app.listen(process.env.PORT || 3000, () => console.log('Web server ready.'));

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("❌ Error: BOT_TOKEN variable is missing!");
    process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

// الخرائط لتخزين جلسات المستخدمين وحالاتهم الرقمية
const userSockets = new Map();
const userStates = new Map();
const userSessions = new Map();

// دالة تشغيل أو ربط الواتساب لكل مستخدم
async function initWhatsApp(userId, phoneNumber = null, ctx = null) {
    const authFolder = `auth_user_${userId}`;

    // 1️⃣ الحل: إغلاق أي اتصال قديم نشط للمستحدم لتجنب التداخل والتكرار
    if (userSockets.has(userId)) {
        try {
            userSockets.get(userId).end();
        } catch (e) {}
        userSockets.delete(userId);
    }

    // 2️⃣ الحل: مسح المجلد القديم تماماً إذا كان المستخدم يطلب كوداً جديداً لضمان جلسة نظيفة
    if (phoneNumber && fs.existsSync(authFolder)) {
        try {
            fs.rmSync(authFolder, { recursive: true, force: true });
        } catch (e) {}
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Mac OS', 'Chrome', '121.0.0.0'] // تحديث المتصفح لإصدار حديث ومقبول من واتساب
    });

    userSockets.set(userId, sock);
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                initWhatsApp(userId, null, ctx);
            } else {
                userSockets.delete(userId);
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
                if (ctx) ctx.reply('⚠️ تم تسجيل الخروج أو إلغاء الجلسة بنجاح.');
            }
        } else if (connection === 'open') {
            if (ctx) ctx.reply('✅ تم ربط حساب الواتساب الخاص بك بنجاح! يمكنك الآن إرسال ملفات الفحص.');
        }
    });

    // توليد كود التحقق الجديد بالرقم الجديد
    if (phoneNumber) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                let formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                if (ctx) {
                    await ctx.reply(`🔑 *Your Pairing Code:*\n\n\`${formattedCode}\``, { parse_mode: 'Markdown' });
                    await ctx.reply('ℹ️ افتح الواتساب في هاتفك ⬅️ الأجهزة المرتبطة ⬅️ ربط جهاز ⬅️ اختر "الربط برقم الهاتف عوضاً عن ذلك" ثم أدخل الكود أعلاه.');
                }
            } catch (err) {
                console.error(err);
                if (ctx) ctx.reply('❌ فشل توليد كود التحقق. الرجاء المحاولة مرة أخرى بعد دقيقة.');
            }
        }, 3000); 
    }
}

// القائمة الرئيسية للبوت
function sendMainMenu(ctx) {
    const welcomeText = `👋 *WA Checker Bot*\n\nCheck WhatsApp numbers using your own accounts.\n\nYour accounts distribute checks automatically for speed & safety.`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📱 Account', 'manage_account')],
        [Markup.button.callback('ℹ️ Help', 'view_help')]
    ]);
    ctx.replyWithMarkdown(welcomeText, keyboard);
}

bot.start((ctx) => {
    if (fs.existsSync(`auth_user_${ctx.from.id}`)) {
        initWhatsApp(ctx.from.id);
    }
    sendMainMenu(ctx);
});

// دعم أمر /account مباشرة بالشات
async function showAccountManager(ctx, isCommand = false) {
    const userId = ctx.from.id;
    const isConnected = userSockets.has(userId) && userSockets.get(userId)?.ws?.readyState === 1;

    const message = isConnected ? '⚙️ *إعدادات الحساب:*\n\nحساب الواتساب الخاص بك متصل حالياً وجاهز للاستخدام.' : '⚙️ *إعدادات الحساب:*\n\nلم تقم بربط حساب واتساب حتى الآن للبدء في الفحص.';
    const keyboard = isConnected
        ? Markup.inlineKeyboard([[Markup.button.callback('❌ Logout Account', 'logout_wa')], [Markup.button.callback('⬅️ Back', 'back_menu')]])
        : Markup.inlineKeyboard([[Markup.button.callback('📱 Link via Pair Code', 'request_code')], [Markup.button.callback('⬅️ Back', 'back_menu')]]);

    if (isCommand) {
        await ctx.replyWithMarkdown(message, keyboard);
    } else {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
    }
}

bot.command('account', (ctx) => showAccountManager(ctx, true));
bot.action('manage_account', (ctx) => showAccountManager(ctx, false));

bot.action('request_code', (ctx) => {
    userStates.set(ctx.from.id, 'WAITING_PHONE_NUMBER');
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('Back', 'manage_account')]]);
    ctx.editMessageText('📱 *Pair Code Login*\n\nSend your phone number with country code:\n\nExample: `249966904352`', { parse_mode: 'Markdown', ...keyboard });
});

bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);

    if (state === 'WAITING_PHONE_NUMBER') {
        let phone = ctx.message.text.replace(/\D/g, ''); 
        if (phone.length < 8) {
            return ctx.reply('❌ الرقم الذي أدخلته غير صحيح. تأكد من كتابة رمز الدولة يليه الرقم مباشرة.');
        }

        userStates.delete(userId);
        await ctx.reply('⏳ جاري الاتصال بخوادم الواتساب وتوليد الكود الجديد الخاص بك...');
        await initWhatsApp(userId, phone, ctx);
    } else {
        return next();
    }
});

bot.action('logout_wa', async (ctx) => {
    const userId = ctx.from.id;
    const sock = userSockets.get(userId);
    if (sock) {
        try { await sock.logout(); } catch(e) {}
    }
    const authFolder = `auth_user_${userId}`;
    if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
    userSockets.delete(userId);
    ctx.answerCbQuery('تم تسجيل الخروج بنجاح');
    ctx.deleteMessage().catch(() => {});
    sendMainMenu(ctx);
});

bot.action('back_menu', (ctx) => {
    ctx.deleteMessage().catch(() => {});
    sendMainMenu(ctx);
});

bot.action('view_help', (ctx) => {
    ctx.reply('ℹ️ للبدء بالفحص: قم بربط حسابك من أمر /account، ثم أرسل ملف .txt يحتوي على الأرقام.');
    ctx.answerCbQuery();
});

// استقبال ومعالجة ملفات الفحص النصية
bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const sock = userSockets.get(userId);
    
    if (!sock || sock.ws?.readyState !== 1) {
        return ctx.reply('❌ يجب عليك ربط حساب الواتساب الخاص بك أولاً عبر استخدام الأمر /account قبل إرسال ملف الفحص.');
    }

    const doc = ctx.message.document;
    if (!doc.file_name.endsWith('.txt')) {
        return ctx.reply('❌ الرجاء إرسال ملف بصيغة .txt فقط.');
    }

    const waitingMsg = await ctx.reply('⏳ جاري تحميل الملف وبدء الفحص، يرجى الانتظار...');

    try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await axios.get(fileLink.href);
        const text = response.data;
        
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
        
        let registered = [];
        let unregistered = [];
        let failed = 0;

        for (let num of lines) {
            let cleanNum = num.replace(/\D/g, ''); 
            if (!cleanNum) continue;

            try {
                const [result] = await sock.onWhatsApp(cleanNum);
                if (result && result.exists) {
                    registered.push(num);
                } else {
                    unregistered.push(num);
                }
            } catch (err) {
                failed++;
            }
        }

        userSessions.set(userId, { registered, unregistered, failed, total: lines.length });

        const textResponse = `✅ *Check Complete!*\n\n📊 *Total:* ${lines.length}\n✅ *Registered:* ${registered.length}\n❌ *Unregistered:* ${unregistered.length}\n⚠️ *Failed:* ${failed}\n\nChoose an option below:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Registered', 'view_reg'), Markup.button.callback('Unregistered', 'view_unreg')],
            [Markup.button.callback('Failed', 'view_failed'), Markup.button.callback('TXT', 'get_txt')],
            [Markup.button.callback('CSV', 'get_csv'), Markup.button.callback('Menu', 'view_menu')]
        ]);

        await ctx.telegram.deleteMessage(ctx.chat.id, waitingMsg.message_id);
        await ctx.replyWithMarkdown(textResponse, keyboard);

    } catch (error) {
        console.error(error);
        ctx.reply('❌ حدث خطأ مفاجئ أثناء معالجة الملف.');
    }
});

// التعامل مع أزرار لوحة نتائج الفحص
bot.action('view_reg', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session || session.registered.length === 0) return ctx.answerCbQuery('لا توجد أرقام مسجلة.');
    const list = session.registered.slice(0, 40).join('\n'); 
    await ctx.reply(`✅ *Registered (${session.registered.length}):*\n\n${list}${session.registered.length > 40 ? '\n...' : ''}`);
    ctx.answerCbQuery();
});

bot.action('view_unreg', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session || session.unregistered.length === 0) return ctx.answerCbQuery('لا توجد أرقام غير مسجلة.');
    const list = session.unregistered.slice(0, 40).join('\n');
    await ctx.reply(`❌ *Unregistered (${session.unregistered.length}):*\n\n${list}${session.unregistered.length > 40 ? '\n...' : ''}`);
    ctx.answerCbQuery();
});

bot.action('view_failed', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery();
    await ctx.reply(`⚠️ عدد العمليات الفاشلة: ${session.failed}`);
    ctx.answerCbQuery();
});

bot.action('get_txt', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session || session.registered.length === 0) return ctx.answerCbQuery('لا توجد بيانات لتصديرها.');
    const buffer = Buffer.from(session.registered.join('\n'), 'utf-8');
    await ctx.replyWithDocument({ source: buffer, filename: 'registered.txt' });
    ctx.answerCbQuery();
});

bot.action('get_csv', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    if (!session) return ctx.answerCbQuery();
    let csvContent = 'Number,Status\n';
    session.registered.forEach(n => csvContent += `${n},Registered\n`);
    session.unregistered.forEach(n => csvContent += `${n},Unregistered\n`);
    const buffer = Buffer.from(csvContent, 'utf-8');
    await ctx.replyWithDocument({ source: buffer, filename: 'results.csv' });
    ctx.answerCbQuery();
});

bot.action('view_menu', (ctx) => {
    ctx.reply('📋 القائمة الرئيسية: أرسل ملف .txt جديد لبدء الفحص.');
    ctx.answerCbQuery();
});

bot.launch().then(() => {
    console.log('🤖 Telegram Bot is running perfectly...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
