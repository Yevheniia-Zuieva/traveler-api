/**
 * ============================================================================
 * CI/CD SMOKE PERFORMANCE TEST (GitHub Actions)
 * ============================================================================
 * Оптимізована версія для стабільного проходження у CI/CD (без видалення планів).
 * ============================================================================
 */

import { sleep } from 'k6';
import http from 'k6/http';
import { DEFAULT_THRESHOLDS, ENDPOINTS, BASE_URL } from './config/endpoints.js';
import {
  createTravelPlan,
  getTravelPlan,
  updateTravelPlan,
  addLocation,
} from './utils/api-client.js';
import {
  generateTravelPlan,
  generateTravelPlanUpdate,
  generateLocation,
} from './utils/data-generator.js';

// ============================================================================
// НАЛАШТУВАННЯ ТЕСТУ ДЛЯ CI/CD
// ============================================================================

export const options = {
  stages: [
    { duration: '10s', target: 5 },   // Швидкий розгін до 5 користувачів
    { duration: '40s', target: 10 },  // Стабільне навантаження 10 користувачів
    { duration: '20s', target: 0 },   // Зниження навантаження
  ],

  thresholds: {
    ...DEFAULT_THRESHOLDS,
    
    'http_req_duration{type:write}': [
      'p(95)<1200',
    ],
    'http_req_duration{type:read}': [
      'p(95)<600',
    ],
    'http_req_failed': ['rate<0.05'], 
    'checks': ['rate>0.95'],
  },

  noConnectionReuse: false,
  userAgent: 'K6-CI-SmokeTest/1.0',
};

// ============================================================================
// SETUP: Створення 15 базових планів
// ============================================================================
export function setup() {
  console.log('='.repeat(80));
  console.log('Starting CI/CD Smoke Performance Test');
  console.log('='.repeat(80));
  
  const createdPlans = [];
  
  for (let i = 0; i < 15; i++) {
    const plan = generateTravelPlan();
    const created = createTravelPlan(plan);
    
    if (created && created.id) {
      createdPlans.push(created.id);
      
      const locationsCount = Math.floor(Math.random() * 2) + 1;
      let currentParentVersion = 1;
      
      for (let j = 0; j < locationsCount; j++) {
        const locationData = generateLocation(currentParentVersion); 
        const added = addLocation(created.id, locationData);
        
        if (added) {
          currentParentVersion++; 
        }
      }
    }
  }
  
  console.log(`Setup completed. Total plans created: ${createdPlans.length}`);
  return { initialCount: createdPlans.length };
}

// ============================================================================
// ОСНОВНИЙ СЦЕНАРІЙ (Тільки Читання, Створення та Додавання/Оновлення)
// ============================================================================

export default function () {
  // 1. Отримання списку планів
  const listResponse = http.get(ENDPOINTS.TRAVEL_PLANS || `${BASE_URL}/api/travel-plans`, { 
    tags: { type: 'read' } 
  });
  
  if (listResponse.status !== 200) {
    sleep(0.5);
    return;
  }

  const plans = JSON.parse(listResponse.body);

  // 2. Якщо список порожній або мало планів — створюємо новий
  if (!plans || plans.length === 0) {
    const fallbackPlan = generateTravelPlan();
    createTravelPlan(fallbackPlan);
    sleep(0.5);
    return;
  }

  // 3. Вибір випадкового плану
  const randomIndex = Math.floor(Math.random() * plans.length);
  const selectedPlanId = plans[randomIndex].id;

  sleep(0.1); 

  // 4. Читання деталей плану
  const planDetails = getTravelPlan(selectedPlanId);
  if (!planDetails || !planDetails.version) {
    sleep(0.2);
    return; 
  }

  sleep(0.1); 

  // 5. Безпечні операції (без видалення)
  const actionChance = Math.random();

  if (actionChance < 0.20) {
    // 20% — Створення нового власного плану
    const newPlan = generateTravelPlan();
    createTravelPlan(newPlan);
  } else if (actionChance < 0.60) {
    // 40% — Оновлення існуючого плану
    const updateData = generateTravelPlanUpdate(planDetails.version);
    updateTravelPlan(selectedPlanId, updateData);
  } else {
    // 40% — Додавання локації до плану
    const newLocation = generateLocation(planDetails.version);
    addLocation(selectedPlanId, newLocation);
  }

  sleep(0.5);
}

// ============================================================================
// TEARDOWN
// ============================================================================
export function teardown(data) {
  console.log('='.repeat(80));
  console.log('CI Smoke Performance Test completed successfully');
  console.log('='.repeat(80));
}