/**
 * ============================================================================
 * REALISTIC USER JOURNEY STRESS TEST (PLANS + LOCATIONS)
 * ============================================================================
 * 
 * МЕТА:
 * Визначити межі системи та знайти точку відмови (breaking point) шляхом 
 * поетапного збільшення навантаження до критичних значень (до 600 користувачів) 
 * та перевірити відновлення системи після зниження навантаження.
 * 
 * ХІД ВИКОНАННЯ ТЕСТУ (Stress Testing):
 * 1. 2 хвилини — наростання до 100 користувачів
 * 2. 2 хвилини — наростання до 200 користувачів
 * 3. 2 хвилини — наростання до 400 користувачів
 * 4. 2 хвилини — критичне навантаження до 600 користувачів
 * 5. 10 хвилин — зниження до 0 для перевірки відновлення системи
 * ============================================================================
 *
 * * ПОВЕДІНКА КОРИСТУВАЧА (СЦЕНАРІЙ):
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
// НАЛАШТУВАННЯ СТРЕС-ТЕСТУ
// ============================================================================

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 400 },
    { duration: '2m', target: 600 }, // Критичне навантаження[cite: 8]
    { duration: '10m', target: 0 },  // Зниження та перевірка відновлення[cite: 8]
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
  userAgent: 'K6-StressTest/1.0',
};

// ============================================================================
// SETUP: Виконується 1 раз до старту тесту
// ============================================================================
export function setup() {
  console.log('='.repeat(80));
  console.log('Starting Stress Test (Plans + Locations)');
  console.log('Target: Gradual ramp-up up to 600 concurrent users');
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
  console.log('Stress Test completed');
  console.log('='.repeat(80));
}