#!/usr/bin/env node

/**
 * Founder Chat Acceptance Tests
 * Tests the founder chat through the API with real authentication
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qygssfuqkqzrhwduafft.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3ec8dCipZ-mgOzkgVwchgA_Jjn5_8w7';
const API_URL = 'https://api.departify.app';
const ORG_ID = '7a9f4986-23ba-4d47-8018-f92e304c539d';

// Test credentials - user needs to provide these
const EMAIL = process.env.FOUNDER_EMAIL || 'tres@tres.com';
const PASSWORD = process.env.FOUNDER_PASSWORD || '';

async function authenticate() {
  if (!PASSWORD) {
    console.error('Please set FOUNDER_PASSWORD environment variable');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: { session }, error } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });

  if (error) {
    console.error('Authentication failed:', error.message);
    process.exit(1);
  }

  return session.access_token;
}

async function testFounderChat(token, message) {
  const response = await fetch(`${API_URL}/api/customer-zero/${ORG_ID}/command-center/message`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  const data = await response.json();
  return data.reply || data.error || 'No response';
}

async function runTests() {
  console.log('=== Founder Chat Acceptance Tests ===\n');

  let token;
  try {
    token = await authenticate();
    console.log('✓ Authenticated successfully\n');
  } catch (err) {
    console.error('✗ Authentication failed:', err.message);
    process.exit(1);
  }

  const tests = [
    { name: 'pwd', message: 'ejecuta pwd y dime el directorio' },
    { name: 'list skills', message: 'lista las skills instaladas' },
    { name: 'create file', message: 'crea un archivo founder-test.txt con el texto DEPARTIFY-FOUNDER-OK' },
    { name: 'read file', message: 'lee founder-test.txt' },
    { name: 'delete file', message: 'elimina founder-test.txt' },
  ];

  for (const test of tests) {
    console.log(`=== Test: ${test.name} ===`);
    try {
      const reply = await testFounderChat(token, test.message);
      console.log(reply);
    } catch (err) {
      console.error('Error:', err.message);
    }
    console.log('');
  }

  console.log('=== Tests Complete ===');
}

runTests().catch(console.error);
