/**
 * ============================================================================
 * SMOKE TEST
 * ============================================================================
 * 
 * МЕТА:
 * Швидка базова перевірка що API працює і всі основні функції доступні.
 * Це попередній тест який запускається перед повноцінним навантажувальним
 * тестуванням щоб переконатися що система взагалі функціонує.
 * 
 * ХІД ВИКОНАННЯ ТЕСТУ:
 * 1. Warm-up фаза (30 секунд): Поступове збільшення до 5 користувачів
 * 2. Steady state (1 хвилина): Стабільне навантаження з 5 користувачів
 * 3. Cool-down фаза (30 секунд): Зменшення навантаження
 * 
 * КОЖНА ІТЕРАЦІЯ ПЕРЕВІРЯЄ:
 * - Health check endpoint
 * - Створення travel plan
 * - Читання travel plan
 * - Додавання локації
 * - Оновлення плану
 * - Видалення плану
 * 
 * КРИТЕРІЇ УСПІХУ:
 * - Всі endpoints відповідають в межах тайм-ауту
 * - Жодних critical errors
 * - >100% перевірок проходять успішно
 * 
 * ЯКЩО SMOKE TEST НЕ ПРОХОДИТЬ:
 * - НЕ запускайте повні навантажувальні тести
 * - Перевірте що API запущений
 * - Перевірте конфігурацію (BASE_URL)
 * - Перевірте логи сервера
 * 
 * ============================================================================
 */

import { sleep } from 'k6';
import { SMOKE_THRESHOLDS } from './config/endpoints.js';
import {
  checkHealth,
  createTravelPlan,
  getTravelPlan,
  addLocation,
  updateTravelPlan,
  deleteTravelPlan,
  listTravelPlans,
  verifyPlanDeleted,
  thinkTime,
} from './utils/api-client.js';
import {
  generateTravelPlan,
  generateLocation,
} from './utils/data-generator.js';

// ============================================================================
// НАЛАШТУВАННЯ ТЕСТУ
// ============================================================================

export const options = {
  // Дуже помірне навантаження - лише перевірка функціональності
  stages: [
    { duration: '5s', target: 2 },   // Warm-up
    { duration: '10s', target: 5 },    // Stable load
    { duration: '5s', target: 0 },   // Cool-down
  ],

  // М'які пороги - головне щоб працювало
  thresholds: {
    ...SMOKE_THRESHOLDS,
    
    // Все має відповідати розумно швидко
    'http_req_duration': ['p(95)<2000'],
    
    // Строго для запису: жодних фейлів
    'http_req_failed{type:write}': ['rate==0'],
    // Для читання дозволяємо невелику частку через очікуваний 404 після видалення
    'http_req_failed{type:read}': ['rate<0.12'],
    // Власні помилки API не допускаються
    'api_errors': ['rate==0'],
    
    // Більшість перевірок мають проходити
    'checks': ['rate>0.90'],
  },

  userAgent: 'K6-SmokeTest/1.0',
};

// ============================================================================
// ОСНОВНИЙ СЦЕНАРІЙ ТЕСТУ
// ============================================================================

export default function () {
  // --------------------------------------------------
  // 1. HEALTH CHECK
  // --------------------------------------------------
  const isHealthy = checkHealth();
  
  if (!isHealthy) {
    console.error('❌ API health check failed!');
    return; // Немає сенсу продовжувати якщо API не здоровий
  }

  thinkTime(0.5, 1);

  // --------------------------------------------------
  // 2. СПИСОК ПЛАНІВ (може бути порожнім)
  // --------------------------------------------------
  const plans = listTravelPlans();
  
  thinkTime(0.5, 1);

  // --------------------------------------------------
  // 3. СТВОРЕННЯ TRAVEL PLAN
  // --------------------------------------------------
  const planData = generateTravelPlan();
  planData.title = 'Smoke Test Plan';
  
  console.debug(`📝 Creating travel plan with data: ${JSON.stringify(planData)}`);
  const plan = createTravelPlan(planData);
  
  if (!plan) {
    console.error('❌ Failed to create travel plan');
    console.error('   This could indicate:');
    console.error('   - API returned non-201 status');
    console.error('   - Response body is not valid JSON');
    console.error('   - Plan data validation failed');
    return;
  }

  const planId = plan.id;
  console.debug(`✓ Created plan: ${planId}`);

  thinkTime(1, 1.5);

  // --------------------------------------------------
  // 4. ЧИТАННЯ TRAVEL PLAN
  // --------------------------------------------------
  const retrievedPlan = getTravelPlan(planId);
  
  if (!retrievedPlan) {
    console.error(`❌ Failed to retrieve travel plan: ${planId}`);
    console.error('   This could indicate:');
    console.error('   - API returned non-200 status');
    console.error('   - Response body is not valid JSON');
    console.error('   - Plan was not found (404)');
    deleteTravelPlan(planId, 1);
    return;
  }

  console.debug(`✓ Retrieved plan: ${planId}`);
  console.debug(`   Plan details: title="${retrievedPlan.title}", version=${retrievedPlan.version}, locations=${retrievedPlan.locations?.length || 0}`);

  thinkTime(1, 1.5);

  // --------------------------------------------------
  // 5. ДОДАВАННЯ ЛОКАЦІЇ
  // --------------------------------------------------
  const locationData = generateLocation();
  locationData.name = 'Smoke Test Location';
  
  locationData.parent_version = retrievedPlan.version;

  console.debug(`📍 Adding location to plan ${planId} with data: ${JSON.stringify(locationData)}`);
  const location = addLocation(planId, locationData);
  
  if (!location) {
    console.error(`❌ Failed to add location to plan ${planId}`);
    console.error('   This could indicate:');
    console.error('   - API returned non-201 status');
    console.error('   - Response body is not valid JSON');
    console.error('   - Location data validation failed');
    console.error('   - Plan not found (404)');
    deleteTravelPlan(planId, retrievedPlan.version);
    return;
  }

  console.debug(`✓ Added location: ${location.id}`);

  thinkTime(1, 1.5);

  // --------------------------------------------------
  // 6. ОНОВЛЕННЯ TRAVEL PLAN
  // --------------------------------------------------
  console.debug(`🔄 Re-fetching plan ${planId} to get the latest version...`);
  const planAfterLocationAdd = getTravelPlan(planId);
  
  if (!planAfterLocationAdd) {
      console.error(`❌ Failed to re-fetch plan ${planId} before update`);
      deleteTravelPlan(planId, retrievedPlan.version); // Cleanup
      return;
  }
  console.debug(`✓ Got updated version: ${planAfterLocationAdd.version}`);
  
  
  const updateData = {
      ...planData,
      title: 'Updated Smoke Test Plan',
      // Використовуємо найсвіжішу версію
      version: planAfterLocationAdd.version, 
  };
  
  const updated = updateTravelPlan(planId, updateData);
  
  if (!updated || updated.conflict) {
      console.error('❌ Failed to update travel plan');
      deleteTravelPlan(planId, planAfterLocationAdd.version); // Cleanup
      return;
  }
  
  console.debug(`✓ Updated plan: ${planId}`);

  thinkTime(1, 1.5);

  // --------------------------------------------------
  // 7. ВИДАЛЕННЯ TRAVEL PLAN
  // --------------------------------------------------
  const deleted = deleteTravelPlan(planId, updated.version);
  
  if (!deleted) {
    console.error('❌ Failed to delete travel plan');
    return;
  }

  console.debug(`✓ Deleted plan: ${planId}`);

  thinkTime(1, 1.5);

  // --------------------------------------------------
  // 8. ПЕРЕВІРКА ВИДАЛЕННЯ
  // --------------------------------------------------
  const isDeleted = verifyPlanDeleted(planId);
  
  if (!isDeleted) {
    console.error(`❌ Plan ${planId} was not properly deleted`);
  }

  sleep(1);
}

// ============================================================================
// SETUP & TEARDOWN
// ============================================================================

export function setup() {
  console.log('='.repeat(80));
  console.log('🔥 SMOKE TEST - Basic Functionality Check');
  console.log('='.repeat(80));
  console.log('Target: 5 concurrent users (minimal load)');
  console.log('Duration: 2 minutes');
  console.log('Purpose: Verify API is functional before heavy load testing');
  console.log('');
  console.log('Testing:');
  console.log('  ✓ Health check');
  console.log('  ✓ List travel plans');
  console.log('  ✓ Create travel plan');
  console.log('  ✓ Read travel plan');
  console.log('  ✓ Add location');
  console.log('  ✓ Update travel plan');
  console.log('  ✓ Delete travel plan');
  console.log('='.repeat(80));
  console.log('');
}

export function teardown(data) {
  console.log('');
  console.log('='.repeat(80));
  console.log('🔥 SMOKE TEST COMPLETED');
  console.log('='.repeat(80));
  console.log('');
  console.log('Next steps:');
  console.log('  ✓ If all checks passed → proceed with load testing');
  console.log('  ✗ If checks failed → fix issues before load testing');
  console.log('='.repeat(80));
}
