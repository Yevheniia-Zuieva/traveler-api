/**
 * ============================================================================
 * REALISTIC USER JOURNEY LOAD TEST (PLANS + LOCATIONS)
 * ============================================================================
 * 
 * МЕТА:
 * Перевірити систему під очікуваним навантаженням, використовуючи реалістичний 
 * сценарій поведінки користувачів. Створює природну конкуренцію за дані, 
 * перевіряє роботу з реляційними зв'язками (Foreign Keys) та каскадним видаленням.
 * 
 * ХІД ВИКОНАННЯ ТЕСТУ (Load Testing):
 * 1. Ramp-up фаза (5 хвилин): Поступове збільшення від 0 до 100 користувачів
 * 2. Steady state (10 хвилин): Стабільне навантаження зі 100 користувачами
 * 3. Ramp-down фаза (5 хвилин): Плавне зменшення навантаження до 0
 * 
 * ПОВЕДІНКА КОРИСТУВАЧА (СЦЕНАРІЙ):
 * - SETUP: Одноразове наповнення системи 200 планами та пов'язаними локаціями (по 1-3 на план).
 * - ІТЕРАЦІЯ (Дії віртуального користувача):
 *   1. Отримує список усіх планів подорожей.
 *   2. Якщо список порожній — створює новий план і виходить.
 *   3. Випадково обирає один план зі списку.
 *   4. Отримує деталі обраного плану (разом з актуальною версією).
 *   5. З певною ймовірністю виконує дію:
 *      - 85% випадків: Активна робота (50% - оновлює сам план, 50% - додає нову локацію).
 *      - 5% випадків: Видаляє план (викликає каскадне видалення локацій у БД).
 *      - 10% випадків: Нічого не робить (імітація простого перегляду).
 * 
 * МЕТРИКИ:
 * - Response time (p95, p99) для кожної операції
 * - Success rate для optimistic locking конфліктів
 * ============================================================================
 */

import { sleep } from 'k6';
import http from 'k6/http';
import { DEFAULT_THRESHOLDS, ENDPOINTS, BASE_URL } from './config/endpoints.js';
import {
  createTravelPlan,
  getTravelPlan,
  updateTravelPlan,
  deleteTravelPlan,
  addLocation,
  thinkTime,
} from './utils/api-client.js';
import {
  generateTravelPlan,
  generateTravelPlanUpdate,
  generateLocation,
} from './utils/data-generator.js';

// ============================================================================
// НАЛАШТУВАННЯ ТЕСТУ
// ============================================================================

export const options = {
  // Профіль навантаження для Load Testing 
  stages: [
    { duration: '5m', target: 100 },  // Наростання до 100 користувачів
    { duration: '10m', target: 100 }, // Утримання навантаження
    { duration: '5m', target: 0 },    // Зниження
  ],

  thresholds: {
    ...DEFAULT_THRESHOLDS,
    
    'http_req_duration{type:write}': [
      'p(95)<1000',
      'p(99)<2000',
    ],
    'http_req_duration{type:read}': [
      'p(95)<500',
      'p(99)<1000',
    ],
  },

  noConnectionReuse: false,
  userAgent: 'K6-Realistic-LoadTest/1.0',
};

// ============================================================================
// SETUP: Виконується 1 раз до старту тесту
// ============================================================================
export function setup() {
  console.log('='.repeat(80));
  console.log('Starting Realistic User Journey Load Test (Plans + Locations)');
  console.log('Target: 100 concurrent users');
  console.log('Duration: 20 minutes total (5m up -> 10m steady -> 5m down)');
  console.log('='.repeat(80));
  
  console.log('Початок Setup: Створюємо 200 базових планів та локації для них...');
  const createdPlans = [];
  
  for (let i = 0; i < 200; i++) {
    const plan = generateTravelPlan();
    const created = createTravelPlan(plan);
    
    if (created && created.id) {
      createdPlans.push(created.id);
      
      // ГЕНЕРУЄМО ЛОКАЦІЇ: Від 1 до 3 локацій для кожного плану
      const locationsCount = Math.floor(Math.random() * 3) + 1;
      let currentParentVersion = 1; // Початкова версія щойно створеного плану
      
      for (let j = 0; j < locationsCount; j++) {
        const locationData = generateLocation(currentParentVersion); 
        const added = addLocation(created.id, locationData);
        
        // Якщо локація успішно додалась і версія на плані зросла, 
        // збільшуємо версію для наступної локації у цьому ж плані
        if (added) {
          currentParentVersion++; 
        }
      }
    }
  }
  
  console.log(`Setup завершено. Успішно створено планів: ${createdPlans.length}`);
  return { initialCount: createdPlans.length };
}

// ============================================================================
// ОСНОВНИЙ СЦЕНАРІЙ ТЕСТУ
// ============================================================================

export default function () {
  // 1. Користувач отримує список усіх планів
  const listResponse = http.get(ENDPOINTS.TRAVEL_PLANS || `${BASE_URL}/api/travel-plans`, { 
    tags: { type: 'read' } 
  });
  
  if (listResponse.status !== 200) {
    sleep(1);
    return;
  }

  const plans = JSON.parse(listResponse.body);

  // 2. ОБРОБКА ПОРОЖНЬОГО СПИСКУ
  if (!plans || plans.length === 0) {
    const fallbackPlan = generateTravelPlan();
    createTravelPlan(fallbackPlan);
    thinkTime(1, 2);
    return;
  }

  // 3. ВИПАДКОВИЙ ВИБІР ПЛАНУ
  const randomIndex = Math.floor(Math.random() * plans.length);
  const selectedPlanId = plans[randomIndex].id;

  thinkTime(1, 3); // Імітація часу на пошук очима по списку

  // 4. ЧИТАННЯ ДЕТАЛЕЙ ПЛАНУ (для отримання актуальної версії)
  const planDetails = getTravelPlan(selectedPlanId);
  if (!planDetails || !planDetails.version) {
    sleep(1);
    return; 
  }

  thinkTime(1, 2); // Імітація часу на читання деталей плану

  // 5. ПРИЙНЯТТЯ РІШЕННЯ ТА ДІЯ
  const actionChance = Math.random();

  if (actionChance < 0.05) {
    // 5% - ВИДАЛЕННЯ ПЛАНУ (Видалить і всі пов'язані локації)
    deleteTravelPlan(selectedPlanId, planDetails.version);
    
  } else if (actionChance < 0.90) {
    // 85% - АКТИВНА РОБОТА З ДАНИМИ
    
    // З імовірністю 50/50 користувач або оновить план, або додасть локацію
    if (Math.random() > 0.5) {
      const updateData = generateTravelPlanUpdate(planDetails.version);
      updateTravelPlan(selectedPlanId, updateData);
    } else {
      const newLocation = generateLocation(planDetails.version);
      addLocation(selectedPlanId, newLocation);
    }
    
  }
  // 10% - ПРОСТИЙ ПЕРЕГЛЯД (без дій)

  sleep(Math.random() * 2 + 1);
}

// ============================================================================
// TEARDOWN
// ============================================================================
export function teardown(data) {
  console.log('='.repeat(80));
  console.log('Realistic Load Test completed');
  console.log('='.repeat(80));
}