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

// ========== UPDATE USER (FIXED - WITH ALL FIELDS) ==========
app.post('/api/user/update', async (req, res) => {
    const { 
        telegram_id, total_coins, watched_count, referral_coins,
        last_daily_bonus, task_join_channel,
        hourly_bonus_ads, hourly_bonus_claim_time, hourly_bonus_last_claim_time,
        daily_challenge_ads, daily_challenge_claim_time, daily_challenge_last_claim_time
    } = req.body;
    
    if (!telegram_id) {
        return res.json({ ok: false, error: "missing_telegram_id" });
    }
    
    try {
        const updateData = {};
        if (total_coins !== undefined) updateData.total_coins = total_coins;
        if (watched_count !== undefined) updateData.watched_count = watched_count;
        if (referral_coins !== undefined) updateData.referral_coins = referral_coins;
        if (last_daily_bonus !== undefined) updateData.last_daily_bonus = last_daily_bonus;
        if (task_join_channel !== undefined) updateData.task_join_channel = task_join_channel;
        if (hourly_bonus_ads !== undefined) updateData.hourly_bonus_ads = hourly_bonus_ads;
        if (hourly_bonus_claim_time !== undefined) updateData.hourly_bonus_claim_time = hourly_bonus_claim_time;
        if (hourly_bonus_last_claim_time !== undefined) updateData.hourly_bonus_last_claim_time = hourly_bonus_last_claim_time;
        if (daily_challenge_ads !== undefined) updateData.daily_challenge_ads = daily_challenge_ads;
        if (daily_challenge_claim_time !== undefined) updateData.daily_challenge_claim_time = daily_challenge_claim_time;
        if (daily_challenge_last_claim_time !== undefined) updateData.daily_challenge_last_claim_time = daily_challenge_last_claim_time;
        
        updateData.last_sync = new Date().toISOString();
        
        const { error } = await supabase
            .from('users')
            .update(updateData)
            .eq('telegram_id', telegram_id);
        
        if (error) throw error;
        
        console.log(`✅ User ${telegram_id} updated:`, updateData);
        res.json({ ok: true });
        
    } catch (error) {
        console.error("Update error:", error);
        res.json({ ok: false, error: error.message });
    }
});

// ========== GET USER (FIXED - WITH ALL FIELDS) ==========
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
    
    res.json({ ok: true, user: data });
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
