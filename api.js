// api.js - سرور API برای مدیریت جایزه‌ها
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// ========== SUPABASE CONFIGURATION ==========
const SUPABASE_URL = "https://yeexmptexqthwszknwuf.supabase.co";
const SUPABASE_KEY = "sb_publishable_SFZv_qcbdsO1sv1cHitKZw_V7W25RIn";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ========== API: Claim Reward ==========
app.post('/api/claim-reward', async (req, res) => {
    const { telegram_id, reward, action_id } = req.body;
    
    console.log(`💰 Claim request: userId=${telegram_id}, amount=${reward}, actionId=${action_id}`);
    
    try {
        // 1. Check for duplicate action_id
        const { data: existing, error: checkError } = await supabase
            .from('reward_claims')
            .select('id')
            .eq('action_id', action_id)
            .single();
        
        if (existing) {
            console.log("⚠️ Duplicate action detected!");
            return res.json({ ok: false, error: "duplicate" });
        }
        
        // 2. Get current user data
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('total_coins')
            .eq('telegram_id', telegram_id)
            .single();
        
        if (userError || !userData) {
            return res.json({ ok: false, error: "user_not_found" });
        }
        
        const currentCoins = userData.total_coins || 0;
        const newCoins = currentCoins + reward;
        
        // 3. Update user's coins
        const { error: updateError } = await supabase
            .from('users')
            .update({ total_coins: newCoins, last_sync: new Date().toISOString() })
            .eq('telegram_id', telegram_id);
        
        if (updateError) {
            throw updateError;
        }
        
        // 4. Record the claim
        const { error: claimError } = await supabase
            .from('reward_claims')
            .insert({
                action_id: action_id,
                user_id: telegram_id,
                amount: reward
            });
        
        if (claimError) {
            console.error("Claim record error:", claimError);
        }
        
        console.log(`✅ Reward claimed! New coins: ${newCoins}`);
        return res.json({ ok: true, newCoins: newCoins });
        
    } catch (error) {
        console.error("❌ Server error:", error);
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

// ========== API: Health Check ==========
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ API Server running on port ${PORT}`);
});