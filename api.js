import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const SUPABASE_URL = "https://yeexmptexqthwszknwuf.supabase.co";
const SUPABASE_KEY = "sb_publishable_SFZv_qcbdsO1sv1cHitKZw_V7W25RIn";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ========== IDEMPOTENCY (جلوگیری از دابل کلیک) ==========
const usedActions = new Set();

setInterval(() => {
    usedActions.clear();
    console.log("🧹 Cleaned usedActions cache");
}, 24 * 60 * 60 * 1000);

// ========== RATE LIMIT (محدودیت سرعت) ==========
const rateLimit = new Map();

// ========== VALID REWARDS ==========
const VALID_REWARDS = [10, 20, 100, 500, 1000];

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== CLAIM REWARD ==========
app.post('/api/claim-reward', async (req, res) => {
    const { telegram_id, reward, action_id } = req.body;
    
    console.log(`💰 Claim: user=${telegram_id}, amount=${reward}, action=${action_id}`);
    
    // 1. بررسی وجود فیلدها
    if (!telegram_id || !reward || !action_id) {
        return res.json({ ok: false, error: "missing_fields" });
    }
    
    // 2. RATE LIMIT CHECK (جدید)
    const now = Date.now();
    const lastRequest = rateLimit.get(telegram_id) || 0;
    if (now - lastRequest < 3000) {
        console.log(`⚠️ Rate limit hit for user ${telegram_id}`);
        return res.json({ ok: false, error: "too_fast", message: "Please wait 3 seconds between requests" });
    }
    rateLimit.set(telegram_id, now);
    
    // 3. بررسی دابل کلیک
    if (usedActions.has(action_id)) {
        console.log("⚠️ Duplicate!");
        return res.json({ ok: false, error: "duplicate" });
    }
    
    // 4. بررسی مقدار جایزه
    if (!VALID_REWARDS.includes(reward)) {
        return res.json({ ok: false, error: "invalid_reward" });
    }
    
    if (reward < 0 || reward > 1000) {
        return res.json({ ok: false, error: "reward_out_of_range" });
    }
    
    usedActions.add(action_id);
    
    try {
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
        
        const { error: updateError } = await supabase
            .from('users')
            .update({ total_coins: newCoins, last_sync: new Date().toISOString() })
            .eq('telegram_id', telegram_id);
        
        if (updateError) {
            usedActions.delete(action_id);
            throw updateError;
        }
        
        await supabase.from('reward_claims').insert({ action_id, user_id: telegram_id, amount: reward });
        
        console.log(`✅ Success! New coins: ${newCoins}`);
        return res.json({ ok: true, newCoins: newCoins });
        
    } catch (error) {
        console.error("❌ Error:", error);
        usedActions.delete(action_id);
        return res.json({ ok: false, error: "server_error" });
    }
});

// ========== GET USER INFO ==========
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
