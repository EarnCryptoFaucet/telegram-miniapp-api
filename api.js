import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const SUPABASE_URL = "https://yeexmptexqthwszknwuf.supabase.co";
const SUPABASE_KEY = "sb_publishable_SFZv_qcbdsO1sv1cHitKZw_V7W25RIn";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Rate limit and idempotency
const usedActions = new Set();
const rateLimit = new Map();

setInterval(() => { usedActions.clear(); }, 24 * 60 * 60 * 1000);

const VALID_REWARDS = [10, 20, 100, 500, 1000];

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== GET USER (WITH ALL FIELDS) ==========
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
    
    console.log("📥 User data loaded:", {
        hourly_bonus_ads: data.hourly_bonus_ads,
        daily_challenge_ads: data.daily_challenge_ads,
        last_daily_bonus: data.last_daily_bonus
    });
    
    res.json({ ok: true, user: data });
});

// ========== UPDATE USER (WITH ALL FIELDS) ==========
app.post('/api/user/update', async (req, res) => {
    const updateData = req.body;
    const { telegram_id } = updateData;
    
    if (!telegram_id) {
        return res.json({ ok: false, error: "missing_telegram_id" });
    }
    
    console.log("📤 Updating user:", {
        telegram_id,
        hourly_bonus_ads: updateData.hourly_bonus_ads,
        daily_challenge_ads: updateData.daily_challenge_ads,
        hourly_bonus_last_claim_time: updateData.hourly_bonus_last_claim_time,
        daily_challenge_last_claim_time: updateData.daily_challenge_last_claim_time,
        last_daily_bonus: updateData.last_daily_bonus
    });
    
    try {
        const { error } = await supabase
            .from('users')
            .update({
                total_coins: updateData.total_coins,
                watched_count: updateData.watched_count,
                referral_coins: updateData.referral_coins,
                last_daily_bonus: updateData.last_daily_bonus,
                task_join_channel: updateData.task_join_channel,
                hourly_bonus_ads: updateData.hourly_bonus_ads,
                hourly_bonus_claim_time: updateData.hourly_bonus_claim_time,
                hourly_bonus_last_claim_time: updateData.hourly_bonus_last_claim_time,
                daily_challenge_ads: updateData.daily_challenge_ads,
                daily_challenge_claim_time: updateData.daily_challenge_claim_time,
                daily_challenge_last_claim_time: updateData.daily_challenge_last_claim_time,
                last_sync: new Date().toISOString()
            })
            .eq('telegram_id', telegram_id);
        
        if (error) throw error;
        
        console.log("✅ User updated successfully");
        res.json({ ok: true });
        
    } catch (error) {
        console.error("Update error:", error);
        res.json({ ok: false, error: error.message });
    }
});

// ========== CLAIM REWARD ==========
app.post('/api/claim-reward', async (req, res) => {
    const { telegram_id, reward, action_id } = req.body;
    
    console.log(`💰 Claim: user=${telegram_id}, amount=${reward}, action=${action_id}`);
    
    if (!telegram_id || !reward || !action_id) {
        return res.json({ ok: false, error: "missing_fields" });
    }
    
    // Rate limit check
    const now = Date.now();
    const lastRequest = rateLimit.get(telegram_id) || 0;
    if (now - lastRequest < 3000) {
        return res.json({ ok: false, error: "too_fast" });
    }
    rateLimit.set(telegram_id, now);
    
    // Duplicate check
    if (usedActions.has(action_id)) {
        return res.json({ ok: false, error: "duplicate" });
    }
    
    if (!VALID_REWARDS.includes(reward)) {
        return res.json({ ok: false, error: "invalid_reward" });
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
        res.json({ ok: true, newCoins: newCoins });
        
    } catch (error) {
        console.error("Error:", error);
        usedActions.delete(action_id);
        res.json({ ok: false, error: "server_error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
