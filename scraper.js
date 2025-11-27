// ========================================
// 웨이브파크 Puppeteer 스크래퍼
// Headless 브라우저로 렌더링된 DOM 파싱
// ========================================

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

// ===== 설정 =====
const CONFIG = {
  URL: 'https://wavepark.framer.website/',
  TARGET_DATES: ['2025-11-29', '2025-11-30'], // 원하는 날짜
  TARGET_LEVELS: ['초급','중급', '상급'], // 모니터링할 레벨: ['초급'], ['중급'], ['상급'], ['초급', '중급', '상급']
  INCLUDE_TODAY: false, // 오늘 날짜도 포함할지 여부
  INCLUDE_ALL_DATES: false, // 모든 날짜 포함 (테스트용)
  DEBUG: true,
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID
};

// ===== 유틸리티 함수들 =====
// 대기 함수 (waitForTimeout 대체)
function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

// 요소가 나타날 때까지 대기하는 함수
async function waitForElement(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (e) {
    console.log(`요소를 찾을 수 없음: ${selector}`);
    return false;
  }
}

// ===== 메인 스크래핑 함수 =====
async function scrapeWavePark() {
  let browser;
  
  try {
    console.log('='.repeat(60));
    console.log('🚀 웨이브파크 스크래퍼 시작');
    console.log('='.repeat(60));
    
    // 브라우저 시작
    console.log('[DEBUG] 브라우저 시작 중...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    console.log('[DEBUG] ✅ 브라우저 시작 완료');

    const page = await browser.newPage();
    console.log('[DEBUG] 새 페이지 생성 완료');
    
    // User Agent 설정
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 뷰포트 설정
    await page.setViewport({ width: 1920, height: 1080 });
    console.log('[DEBUG] 뷰포트 설정: 1920x1080');
    
    // 날짜 설정 자동화 옵션
    if (CONFIG.INCLUDE_TODAY) {
      const today = new Date().toISOString().split('T')[0];
      if (!CONFIG.TARGET_DATES.includes(today)) {
        CONFIG.TARGET_DATES.push(today);
        console.log(`[DEBUG] 오늘 날짜(${today}) 추가됨`);
      }
    }
    
    if (CONFIG.INCLUDE_ALL_DATES) {
      console.log('[DEBUG] ⚠️ 모든 날짜의 티켓을 모니터링합니다.');
    }
    
    console.log('[DEBUG] 모니터링 대상:');
    console.log('[DEBUG]   - 날짜:', CONFIG.TARGET_DATES);
    console.log('[DEBUG]   - 레벨:', CONFIG.TARGET_LEVELS);
    console.log('[DEBUG]   - DEBUG 모드:', CONFIG.DEBUG);
    console.log('[DEBUG]   - INCLUDE_TODAY:', CONFIG.INCLUDE_TODAY);
    console.log('[DEBUG]   - INCLUDE_ALL_DATES:', CONFIG.INCLUDE_ALL_DATES);
    
    console.log('[DEBUG] 페이지 로딩 중...');
    
    // 페이지 이동
    await page.goto(CONFIG.URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    console.log('[DEBUG] ✅ 페이지 로딩 완료:', CONFIG.URL);
    
    // 추가 대기 (동적 콘텐츠 로딩)
    console.log('[DEBUG] 동적 콘텐츠 로딩 대기 중 (5초)...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('[DEBUG] ✅ 대기 완료');
    
    // 잔여좌우 요소가 로드될 때까지 대기
    console.log('[DEBUG] 잔여좌우 요소 검색 중...');
    const foundElement = await waitForElement(page, '[data-framer-name="잔여좌우"]', 10000);
    if (foundElement) {
      console.log('[DEBUG] ✅ 잔여좌우 요소 발견!');
    } else {
      console.log('[DEBUG] ⚠️ 잔여좌우 요소를 찾을 수 없습니다. 계속 진행...');
    }
    
    // DOM에서 데이터 추출
    console.log('[DEBUG] DOM에서 데이터 추출 시작...');
    const ticketData = await page.evaluate((CONFIG) => {
      const results = [];
      
      console.log('[DOM] 텍스트 노드 수집 시작...');
      // 모든 텍스트 노드를 순서대로 수집
      const allTexts = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            const text = node.textContent.trim();
            if (text && text.length > 0) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );
      
      let node;
      while (node = walker.nextNode()) {
        allTexts.push({
          text: node.textContent.trim(),
          element: node.parentElement
        });
      }
      console.log(`[DOM] 총 ${allTexts.length}개의 텍스트 노드 수집 완료`);
      
      // 데이터 파싱
      let currentDate = null;
      let currentTime = null;
      let currentLevel = null;
      let dateMap = {}; // 날짜별 인덱스 저장
      
      // 현재 연도 추출 (TARGET_DATES에서 첫 번째 날짜의 연도 사용)
      const currentYear = CONFIG.TARGET_DATES && CONFIG.TARGET_DATES.length > 0 
        ? CONFIG.TARGET_DATES[0].split('-')[0] 
        : new Date().getFullYear().toString();
      console.log(`[DOM] 사용할 연도: ${currentYear}`);
      
      // 먼저 모든 날짜를 찾아서 위치 저장
      console.log('[DOM] 날짜 패턴 검색 중...');
      for (let i = 0; i < allTexts.length; i++) {
        const text = allTexts[i].text;
        
        // 날짜 패턴: "9/27 (토)", "9/28 (일)" 등
        const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\s*\([월화수목금토일]\)$/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1]);
          const day = parseInt(dateMatch[2]);
          const dateStr = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          dateMap[i] = dateStr;
          console.log(`[DOM] 날짜 발견: "${text}" -> ${dateStr} (인덱스: ${i})`);
        }
      }
      console.log(`[DOM] 총 ${Object.keys(dateMap).length}개의 날짜 발견`);
      
      // 날짜 인덱스를 기준으로 현재 날짜 결정
      function getCurrentDateForIndex(index) {
        let selectedDate = null;
        let minDistance = Infinity;
        
        for (const [dateIndex, date] of Object.entries(dateMap)) {
          const distance = index - parseInt(dateIndex);
          if (distance >= 0 && distance < minDistance) {
            minDistance = distance;
            selectedDate = date;
          }
        }
        
        // 날짜를 못 찾으면 TARGET_DATES의 첫 번째 날짜 사용
        if (!selectedDate) {
          if (CONFIG.TARGET_DATES && CONFIG.TARGET_DATES.length > 0) {
            selectedDate = CONFIG.TARGET_DATES[0];
            console.log(`[DOM] 날짜를 찾을 수 없어 기본값 사용: ${selectedDate} (인덱스: ${index})`);
          } else {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            selectedDate = `${year}-${month}-${day}`;
            console.log(`[DOM] 날짜를 찾을 수 없어 오늘 날짜 사용: ${selectedDate} (인덱스: ${index})`);
          }
        } else {
          console.log(`[DOM] 날짜 결정: ${selectedDate} (인덱스: ${index}, 거리: ${minDistance})`);
        }
        
        return selectedDate;
      }
      
      console.log('[DOM] 티켓 데이터 파싱 시작...');
      let timeCount = 0;
      let levelCount = 0;
      let seatCount = 0;
      
      for (let i = 0; i < allTexts.length; i++) {
        const item = allTexts[i];
        const text = item.text;
        
        // 현재 인덱스에 해당하는 날짜 업데이트
        if (dateMap[i]) {
          currentDate = dateMap[i];
          console.log(`[DOM] 현재 날짜 업데이트: ${currentDate} (인덱스: ${i})`);
        }
        
        // 시간 패턴: "10:00"
        if (text.match(/^\d{2}:00$/)) {
          currentTime = text;
          timeCount++;
          // 시간이 바뀌면 현재 날짜를 다시 계산
          if (!currentDate) {
            currentDate = getCurrentDateForIndex(i);
          }
          console.log(`[DOM] 시간 발견: ${currentTime} (인덱스: ${i}, 날짜: ${currentDate})`);
        }
        // 레벨 패턴
        else if (text === '상급' || text === '중급' || text === '초급') {
          currentLevel = text;
          levelCount++;
          
          // 배경색 확인 (더 정확한 레벨 판단)
          const parent = item.element.closest('div[style*="background-color"]');
          if (parent) {
            const style = parent.getAttribute('style');
            if (style) {
              if (style.includes('rgb(239, 68, 68)') || style.includes('rgb(239,68,68)')) {
                currentLevel = '상급';
              } else if (style.includes('rgb(59, 130, 246)') || style.includes('rgb(59,130,246)')) {
                currentLevel = '중급';
              } else if (style.includes('rgb(235, 179, 5)') || style.includes('rgb(235,179,5)')) {
                currentLevel = '초급';
              }
            }
          }
          console.log(`[DOM] 레벨 발견: ${currentLevel} (인덱스: ${i})`);
        }
        // 좌석 패턴: "숫자/숫자", "-/숫자", "숫자/-", "매진"
        else if (text.match(/^(-?\d+|-)\/(-?\d+|-)$/) || text === '매진') {
          seatCount++;
          // 잔여좌우 요소인지 확인
          const isInSeatDiv = item.element.closest('[data-framer-name="잔여좌우"]') !== null;
          
          if (isInSeatDiv || (currentLevel && i - allTexts.findIndex(t => t.text === currentLevel) < 10)) {
            let leftSeats = 0;
            let rightSeats = 0;
            
            if (text === '매진') {
              leftSeats = 0;
              rightSeats = 0;
            } else if (text.includes('/')) {
              const parts = text.split('/');
              leftSeats = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
              rightSeats = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
            }
            
            // 원하는 레벨만 저장 (CONFIG.TARGET_LEVELS 확인)
            const isTargetLevel = CONFIG.TARGET_LEVELS.includes(currentLevel);
            const hasSeats = (leftSeats + rightSeats) > 0;
            
            if (isTargetLevel && hasSeats) {
              // 날짜가 없으면 현재 인덱스 기준으로 계산
              const finalDate = currentDate || getCurrentDateForIndex(i);
              
              const ticket = {
                date: finalDate,
                time: currentTime || '시간미확인',
                level: currentLevel,
                leftSeats: leftSeats,
                rightSeats: rightSeats,
                totalSeats: leftSeats + rightSeats,
                raw: text
              };
              
              results.push(ticket);
              console.log(`[DOM] ✅ 티켓 추가: ${currentLevel} - ${finalDate} ${currentTime} - 좌${leftSeats}/우${rightSeats} (${text})`);
            } else {
              if (!isTargetLevel) {
                console.log(`[DOM] ⏭️ 레벨 필터링: ${currentLevel} (타겟 레벨 아님, 인덱스: ${i})`);
              }
              if (!hasSeats) {
                console.log(`[DOM] ⏭️ 좌석 없음: ${text} (인덱스: ${i})`);
              }
            }
          } else {
            console.log(`[DOM] ⏭️ 좌석 패턴 무시: ${text} (잔여좌우 요소 아님, 인덱스: ${i})`);
          }
        }
      }
      
      console.log(`[DOM] 파싱 완료 - 시간: ${timeCount}개, 레벨: ${levelCount}개, 좌석 패턴: ${seatCount}개, 티켓: ${results.length}개`);
      
      // 디버깅: 전체 텍스트 중 일부 출력
      if (CONFIG.DEBUG) {
        console.log('[DOM] === 텍스트 샘플 (날짜/시간/레벨/좌석) ===');
        let sampleCount = 0;
        allTexts.forEach((item, i) => {
          if (item.text.match(/^\d{1,2}\/\d{1,2}\s*\(/) || 
              item.text.match(/^\d{2}:00$/) ||
              item.text.match(/^(상급|중급|초급)$/) ||
              item.text.match(/^\d+\/\d+$/) ||
              item.text === '매진') {
            console.log(`[DOM]   [${i}] ${item.text}`);
            sampleCount++;
            if (sampleCount >= 50) {
              console.log(`[DOM]   ... (최대 50개만 표시)`);
              return false; // forEach 중단은 불가능하지만 의미 전달
            }
          }
        });
        console.log(`[DOM] 샘플 출력 완료 (${sampleCount}개)`);
      }
      
      console.log(`[DOM] 최종 결과: ${results.length}개 티켓 추출 완료`);
      return results;
    }, CONFIG);
    
    console.log('[DEBUG] ========================================');
    console.log(`[DEBUG] 추출된 티켓 (${CONFIG.TARGET_LEVELS.join(', ')} 레벨): ${ticketData.length}개`);
    if (CONFIG.DEBUG && ticketData.length > 0) {
      console.log('[DEBUG] 추출된 티켓 상세:');
      ticketData.forEach((ticket, idx) => {
        console.log(`[DEBUG]   [${idx + 1}] ${ticket.date} ${ticket.time} - ${ticket.level} - 좌${ticket.leftSeats}/우${ticket.rightSeats}`);
      });
    }
    console.log('[DEBUG] ========================================');
    
    // 최종 필터링 로직
    let finalTickets = [];
    
    if (CONFIG.INCLUDE_ALL_DATES) {
      // 모든 날짜 포함
      finalTickets = ticketData;
      console.log('[DEBUG] ⚠️ 모든 날짜의 티켓 포함 (INCLUDE_ALL_DATES=true)');
    } else {
      // 타겟 날짜만 필터링
      console.log('[DEBUG] 타겟 날짜 필터링 시작...');
      console.log('[DEBUG]   타겟 날짜:', CONFIG.TARGET_DATES);
      console.log('[DEBUG]   필터링 전 티켓 수:', ticketData.length);
      
      const dateStats = {};
      ticketData.forEach(ticket => {
        if (!dateStats[ticket.date]) {
          dateStats[ticket.date] = 0;
        }
        dateStats[ticket.date]++;
      });
      console.log('[DEBUG]   날짜별 티켓 수:', dateStats);
      
      finalTickets = ticketData.filter(ticket => {
        const isTargetDate = CONFIG.TARGET_DATES.includes(ticket.date);
        if (!isTargetDate && CONFIG.DEBUG) {
          console.log(`[DEBUG]   ⏭️ 필터링됨: ${ticket.date} ${ticket.time} ${ticket.level} (타겟 날짜 아님)`);
        }
        return isTargetDate;
      });
      
      console.log('[DEBUG]   필터링 후 티켓 수:', finalTickets.length);
      if (CONFIG.DEBUG && finalTickets.length > 0) {
        console.log('[DEBUG]   필터링된 티켓:');
        finalTickets.forEach((ticket, idx) => {
          console.log(`[DEBUG]     [${idx + 1}] ${ticket.date} ${ticket.time} - ${ticket.level} - 좌${ticket.leftSeats}/우${ticket.rightSeats}`);
        });
      }
    }
    
    // 이전 상태 로드
    console.log('[DEBUG] ========================================');
    console.log('[DEBUG] 상태 관리 시작...');
    let previousState = {};
    try {
      const stateData = await fs.readFile('state.json', 'utf8');
      previousState = JSON.parse(stateData);
      const previousKeys = Object.keys(previousState);
      console.log(`[DEBUG] ✅ 이전 상태 로드 완료: ${previousKeys.length}개 티켓 기록`);
      if (CONFIG.DEBUG && previousKeys.length > 0) {
        console.log('[DEBUG] 이전 상태 샘플 (최대 5개):');
        previousKeys.slice(0, 5).forEach(key => {
          const prev = previousState[key];
          console.log(`[DEBUG]   ${key}: ${prev.date} ${prev.time} ${prev.level} - 좌${prev.leftSeats}/우${prev.rightSeats}`);
        });
      }
    } catch (e) {
      console.log('[DEBUG] ⚠️ 이전 상태 없음, 새로 시작');
      console.log(`[DEBUG]   에러: ${e.message}`);
    }
    
    // 새로운 티켓 찾기
    console.log('[DEBUG] 새로운 티켓 검색 중...');
    const newTickets = [];
    let skippedCount = 0;
    let increasedCount = 0;
    
    finalTickets.forEach(ticket => {
      const key = `${ticket.date}-${ticket.time}-${ticket.leftSeats}/${ticket.rightSeats}`;
      
      // 이전 상태와 비교
      if (!previousState[key]) {
        // 완전히 새로운 티켓
        newTickets.push(ticket);
        console.log(`[DEBUG] ✅ 새 티켓 발견: ${ticket.date} ${ticket.time} ${ticket.level} - 좌${ticket.leftSeats}/우${ticket.rightSeats} (${ticket.raw})`);
      } else if (previousState[key].totalSeats < ticket.totalSeats) {
        // 좌석이 늘어난 경우
        newTickets.push(ticket);
        increasedCount++;
        console.log(`[DEBUG] 📈 좌석 증가: ${ticket.date} ${ticket.time} ${ticket.level} - ${previousState[key].totalSeats}석 -> ${ticket.totalSeats}석`);
      } else {
        skippedCount++;
        if (CONFIG.DEBUG) {
          console.log(`[DEBUG] ⏭️ 기존 티켓 (변화 없음): ${ticket.date} ${ticket.time} ${ticket.level} - 좌${ticket.leftSeats}/우${ticket.rightSeats}`);
        }
      }
    });
    
    console.log(`[DEBUG] 검색 완료 - 새 티켓: ${newTickets.length}개, 좌석 증가: ${increasedCount}개, 기존: ${skippedCount}개`);
    
    // 알림 발송
    console.log('[DEBUG] ========================================');
    if (newTickets.length > 0) {
      console.log(`[DEBUG] 🎯 새로운 티켓 ${newTickets.length}개 발견!`);
      
      // 레벨별로 그룹화하여 출력
      const ticketsByLevel = {};
      newTickets.forEach(ticket => {
        if (!ticketsByLevel[ticket.level]) {
          ticketsByLevel[ticket.level] = [];
        }
        ticketsByLevel[ticket.level].push(ticket);
      });
      
      console.log('[DEBUG] 레벨별 티켓 분류:');
      Object.keys(ticketsByLevel).forEach(level => {
        console.log(`[DEBUG]   [${level}] ${ticketsByLevel[level].length}개`);
        ticketsByLevel[level].forEach(t => {
          console.log(`[DEBUG]     - ${t.date} ${t.time}: 좌 ${t.leftSeats} / 우 ${t.rightSeats}`);
        });
      });
      
      console.log('[DEBUG] 알림 발송 시작...');
      await sendNotifications(newTickets);
    } else {
      console.log(`[DEBUG] 😔 새로운 ${CONFIG.TARGET_LEVELS.join('/')} 티켓 없음`);
      if (finalTickets.length > 0) {
        console.log(`[DEBUG]   (기존 티켓 ${finalTickets.length}개는 이미 알림 발송됨)`);
      } else {
        console.log(`[DEBUG]   (타겟 날짜/레벨에 해당하는 티켓이 없음)`);
      }
    }
    
    // 상태 저장
    console.log('[DEBUG] ========================================');
    console.log('[DEBUG] 상태 저장 시작...');
    const newState = {};
    finalTickets.forEach(ticket => {
      const key = `${ticket.date}-${ticket.time}-${ticket.leftSeats}/${ticket.rightSeats}`;
      newState[key] = {
        ...ticket,
        savedAt: new Date().toISOString()
      };
    });
    await fs.writeFile('state.json', JSON.stringify(newState, null, 2));
    console.log(`[DEBUG] ✅ 상태 저장 완료: ${Object.keys(newState).length}개 티켓 기록`);
    
    console.log('[DEBUG] ========================================');
    console.log('[DEBUG] ✅ 스크래핑 완료');
    console.log(`[DEBUG] 최종 결과: ${finalTickets.length}개 티켓`);
    console.log('[DEBUG] ========================================');
    
    return finalTickets;
    
  } catch (error) {
    console.error('[ERROR] ========================================');
    console.error('[ERROR] 스크래핑 에러 발생!');
    console.error('[ERROR] 에러 타입:', error.constructor.name);
    console.error('[ERROR] 에러 메시지:', error.message);
    console.error('[ERROR] 스택 트레이스:');
    console.error(error.stack);
    console.error('[ERROR] ========================================');
    throw error;
  } finally {
    if (browser) {
      console.log('[DEBUG] 브라우저 종료 중...');
      await browser.close();
      console.log('[DEBUG] ✅ 브라우저 종료 완료');
    }
  }
}

// ===== 알림 발송 함수 =====
async function sendNotifications(tickets) {
  console.log(`[NOTIFICATION] 알림 발송 시작: ${tickets.length}개 티켓`);
  
  // 1. Telegram 알림
  // if (CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_CHAT_ID) {
  //   console.log('[NOTIFICATION] Telegram 알림 발송 시도...');
  //   const message = formatTelegramMessage(tickets);
    
  //   try {
  //     const response = await fetch(
  //       `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
  //       {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({
  //           chat_id: CONFIG.TELEGRAM_CHAT_ID,
  //           text: message,
  //           parse_mode: 'HTML'
  //         })
  //       }
  //     );
      
  //     if (response.ok) {
  //       console.log('[NOTIFICATION] ✅ Telegram 알림 발송 성공');
  //     } else {
  //       const errorText = await response.text();
  //       console.error(`[NOTIFICATION] ❌ Telegram 알림 실패: ${response.status} - ${errorText}`);
  //     }
  //   } catch (error) {
  //     console.error('[NOTIFICATION] ❌ Telegram 알림 에러:', error.message);
  //   }
  // } else {
  //   console.log('[NOTIFICATION] ⏭️ Telegram 알림 설정 없음 (토큰 또는 채팅 ID 없음)');
  // }
  
  // 2. Webhook (Google Apps Script) 알림
  if (CONFIG.WEBHOOK_URL) {
    console.log('[NOTIFICATION] Webhook 알림 발송 시도...');
    console.log(`[NOTIFICATION]   URL: ${CONFIG.WEBHOOK_URL.substring(0, 80)}...`);
    console.log(`[NOTIFICATION]   티켓 수: ${tickets.length}개`);
    
    // URL 유효성 검사
    if (!CONFIG.WEBHOOK_URL.startsWith('http://') && !CONFIG.WEBHOOK_URL.startsWith('https://')) {
      console.error('[NOTIFICATION] ❌ 잘못된 URL 형식 (http:// 또는 https://로 시작해야 함)');
      return;
    }
    
    // Google Apps Script URL 확인
    const isGoogleAppsScript = CONFIG.WEBHOOK_URL.includes('script.google.com') || 
                                CONFIG.WEBHOOK_URL.includes('script.googleusercontent.com');
    if (isGoogleAppsScript) {
      console.log('[NOTIFICATION]   Google Apps Script URL 감지됨');
      
      // 잘못된 URL 패턴 확인
      if (CONFIG.WEBHOOK_URL.includes('/edit') || CONFIG.WEBHOOK_URL.includes('/d/')) {
        console.error('[NOTIFICATION] ⚠️ 경고: 스크립트 편집 URL이 아닌 배포 URL을 사용해야 합니다!');
        console.error('[NOTIFICATION]   올바른 URL 형식: https://script.google.com/macros/s/SCRIPT_ID/exec');
        console.error('[NOTIFICATION]   현재 URL이 /edit 또는 /d/를 포함하고 있습니다.');
      }
    }
    
    try {
      const response = await fetch(CONFIG.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets })
      });
      
      if (response.ok) {
        console.log('[NOTIFICATION] ✅ Webhook 알림 발송 성공');
        const responseText = await response.text();
        if (CONFIG.DEBUG && responseText) {
          console.log(`[NOTIFICATION]   응답: ${responseText.substring(0, 200)}`);
        }
      } else {
        const errorText = await response.text();
        console.error(`[NOTIFICATION] ❌ Webhook 알림 실패: ${response.status} ${response.statusText}`);
        
        // 403 에러 상세 분석
        if (response.status === 403) {
          console.error('[NOTIFICATION] ========================================');
          console.error('[NOTIFICATION] 403 Forbidden 에러 원인 분석:');
          console.error('[NOTIFICATION]');
          
          if (isGoogleAppsScript) {
            console.error('[NOTIFICATION] Google Apps Script 접근 권한 문제입니다.');
            console.error('[NOTIFICATION]');
            console.error('[NOTIFICATION] 해결 방법:');
            console.error('[NOTIFICATION] 1. Google Apps Script 프로젝트 열기');
            console.error('[NOTIFICATION] 2. 우측 상단 "배포" > "새 배포" 클릭');
            console.error('[NOTIFICATION] 3. 유형: "웹 앱" 선택');
            console.error('[NOTIFICATION] 4. 실행 사용자: "나" 선택');
            console.error('[NOTIFICATION] 5. 액세스 권한: "모든 사용자" 선택');
            console.error('[NOTIFICATION] 6. 배포 후 생성된 URL 사용 (형식: .../exec)');
            console.error('[NOTIFICATION]');
            console.error('[NOTIFICATION] ⚠️ 스크립트 편집 URL(/edit)이 아닌 배포 URL(/exec)을 사용해야 합니다!');
          } else {
            console.error('[NOTIFICATION] Webhook 서버에서 접근을 거부했습니다.');
            console.error('[NOTIFICATION] - URL이 올바른지 확인');
            console.error('[NOTIFICATION] - 서버의 인증/권한 설정 확인');
            console.error('[NOTIFICATION] - CORS 설정 확인');
          }
          console.error('[NOTIFICATION] ========================================');
        }
        
        // 에러 응답 내용 출력 (HTML이 아닌 경우)
        if (errorText && !errorText.trim().startsWith('<!DOCTYPE')) {
          console.error(`[NOTIFICATION]   에러 메시지: ${errorText.substring(0, 500)}`);
        } else if (errorText && errorText.includes('Access Denied')) {
          console.error(`[NOTIFICATION]   "Access Denied" 페이지가 반환되었습니다.`);
          console.error(`[NOTIFICATION]   이는 접근 권한이 없음을 의미합니다.`);
        }
      }
    } catch (error) {
      console.error('[NOTIFICATION] ❌ Webhook 알림 네트워크 에러:', error.message);
      if (CONFIG.DEBUG) {
        console.error('[NOTIFICATION]   스택:', error.stack);
      }
      
      // 네트워크 에러 상세 정보
      if (error.message.includes('fetch')) {
        console.error('[NOTIFICATION]   네트워크 연결 문제일 수 있습니다.');
        console.error('[NOTIFICATION]   - 인터넷 연결 확인');
        console.error('[NOTIFICATION]   - URL이 올바른지 확인');
        console.error('[NOTIFICATION]   - 방화벽/프록시 설정 확인');
      }
    }
  } else {
    console.log('[NOTIFICATION] ⏭️ Webhook 알림 설정 없음 (WEBHOOK_URL 없음)');
  }
  
  console.log('[NOTIFICATION] 알림 발송 완료');
}

// ===== 메시지 포맷팅 =====
function formatTelegramMessage(tickets) {
  let message = '🏄 <b>웨이브파크 티켓 예매 가능!</b>\n\n';
  
  // 레벨별로 그룹화
  const ticketsByLevel = {};
  tickets.forEach(ticket => {
    if (!ticketsByLevel[ticket.level]) {
      ticketsByLevel[ticket.level] = [];
    }
    ticketsByLevel[ticket.level].push(ticket);
  });
  
  // 레벨별로 메시지 작성
  Object.keys(ticketsByLevel).forEach(level => {
    message += `<b>[${level}]</b>\n`;
    ticketsByLevel[level].forEach(ticket => {
      message += `📅 ${ticket.date} ${ticket.time}\n`;
      message += `🎫 좌측 ${ticket.leftSeats} / 우측 ${ticket.rightSeats}\n`;
      message += `━━━━━━━━━━━━━━\n`;
    });
  });
  
  message += `\n🔗 <a href="https://www.wavepark.co.kr/">지금 바로 예매하기</a>`;
  
  return message;
}

// ===== 실행 =====
if (require.main === module) {
  const startTime = Date.now();
  console.log(`[MAIN] 스크래퍼 시작 시간: ${new Date().toISOString()}`);
  
  scrapeWavePark()
    .then((tickets) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[MAIN] ========================================`);
      console.log(`[MAIN] ✅ 스크래핑 완료 (소요 시간: ${duration}초)`);
      console.log(`[MAIN] 최종 티켓 수: ${tickets.length}개`);
      console.log(`[MAIN] ========================================`);
      process.exit(0);
    })
    .catch(error => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[MAIN] ========================================`);
      console.error(`[MAIN] ❌ 스크래핑 실패 (소요 시간: ${duration}초)`);
      console.error(`[MAIN] 에러: ${error.message}`);
      console.error(`[MAIN] ========================================`);
      process.exit(1);
    });
}

module.exports = { scrapeWavePark };

// ===== package.json =====
/*
{
  "name": "wavepark-scraper",
  "version": "1.0.0",
  "main": "scraper.js",
  "scripts": {
    "start": "node scraper.js",
    "test": "node scraper.js"
  },
  "dependencies": {
    "puppeteer": "^21.0.0"
  }
}
*/

// ===== Docker 실행 (선택사항) =====
/*
FROM node:18-slim

# Chrome 의존성 설치
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

CMD ["node", "scraper.js"]
*/
