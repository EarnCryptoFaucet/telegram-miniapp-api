import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';

const app = express();

// CORS تنظیمات
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Supabase تنظیمات
const SUPABASE_URL = "https://yeexmptexqthwszknwuf.supabase.co";
const SUPABASE_KEY = "sb_publishable_SFZv_qcbdsO1sv1cHitKZw_V7W25RIn";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// حافظه موقت برای جلوگیری از دابل کلیک
const usedActions = new Set();

// پاک کردن خودکار حافظه هر 24 ساعت
setInterval(() => {
    usedActions.clear();
    console.log("🧹 Cleaned usedActions cache");
}, 24 * 60 * 60 * 1000);

// مقادیر مجاز جایزه
const VALID_REWARDS = [10, 20, 100, 500, 1000];

// ========== API: Health Check ==========
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== API: Claim Reward ==========
app.post('/api/claim-reward', async (req, res) => {
    const { telegram_id, reward, action_id } = req.body;
    
    console.log(`💰 Claim: user=${telegram_id}, amount=${reward}, action=${action_id}`);
    
    // بررسی وجود فیلدهای الزامی
    if (!telegram_id || !reward || !action_id) {
        return res.json({ ok: false, error: "missing_fields" });
    }
    
    // بررسی تکراری نبودن در حافظه
    if (usedActions.has(action_id)) {
        console.log("⚠️ Duplicate!");
        return res.json({ ok: false, error: "duplicate" });
    }
    
    // بررسی معتبر بودن مقدار جایزه
    if (!VALID_REWARDS.includes(reward)) {
        console.log(`❌ Invalid reward: ${reward}`);
        return res.json({ ok: false, error: "invalid_reward" });
    }
    
    // بررسی محدوده جایزه
    if (reward < 0 || reward > 1000) {
        return res.json({ ok: false, error: "reward_out_of_range" });
    }
    
    // ذخیره در حافظه موقت
    usedActions.add(action_id);
    
    try {
        // گرفتن اطلاعات کاربر از دیتابیس
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('total_coins')
            .eq('telegram_id', telegram_id)
            .single();
        
        if (userError || !userData) {
            usedActions.delete(action_id);
            return res.json({ ok: false, error: "user_not_found" });
        }
        
        const newCoins = (userData.total_coins || 0) + reward;
        
        // به روز رسانی سکه کاربر
        const { error: updateError } = await supabase
            .from('users')
            .update({ total_coins: newCoins, last_sync: new Date().toISOString() })
            .eq('telegram_id', telegram_id);
        
        if (updateError) {
            usedActions.delete(action_id);
            throw updateError;
        }
        
        // ثبت تاریخچه تراکنش
        await supabase
            .from('reward_claims')
            .insert({
                action_id: action_id,
                user_id: telegram_id,
                amount: reward
            });
        
        console.log(`✅ Success! New coins: ${newCoins}`);
        return res.json({ ok: true, newCoins: newCoins });
        
    } catch (error) {
        console.error("❌ Error:", error);
        usedActions.delete(action_id);
        return res.json({ ok: false, error: "server_error" });
    }
});

// ========== API: Get User Info ==========
app.get('/api/user/:telegram_id', async (req, res) => {
    const { telegram_id } = req.params;
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegram_id)
        .single();
    
    if (error) {
        return res.json({ ok: false, error: error.message });
    }
    
    return res.json({ ok: true, user: data });
});

// ========== شروع سرور ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
