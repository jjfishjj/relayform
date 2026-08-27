import { test, expect } from '@playwright/test';

const guardianPath = '/verifyfirst/';
const forbiddenActionPattern = /(?:payment|pay|wallet|transfer|withdraw|otp|login)/i;

test.describe('Trust Pathway 02 · 電支金融反詐', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(guardianPath, { waitUntil: 'domcontentloaded' });
  });

  test('以六階段詐騙鏈建立 mandate，阻擋資金操作並在撤銷後拒絕重試', async ({ page }) => {
    const forbiddenRequests: string[] = [];
    page.on('request', (request) => {
      if (forbiddenActionPattern.test(request.url())) {
        forbiddenRequests.push(request.url());
      }
    });

    // 1. 選擇來源文件對應的 Pain Point 02 情境。
    await page.locator('.pathway-tab[data-case="finance"]').click();
    await expect(page.locator('#caseInput')).toHaveValue(/高報酬投資邀請/);
    await expect(page.locator('#prepareBtn')).toContainText('建立信任案件委任');

    // 2. 建立 mandate；測試六階段詐騙鏈映射出的高風險邊界。
    await page.locator('#prepareBtn').click();
    await expect(page.locator('#mandateView')).toHaveClass(/active/);
    await expect(page.locator('#mandateScope')).toHaveText('單一投資邀請／付款請求');
    await expect(page.locator('#mandateOutput')).toHaveText('產生防詐提醒、不執行付款');
    await expect(page.locator('#allowList')).toContainText('擷取訊息中的風險訊號');
    await expect(page.locator('#denyList')).toContainText('登入或輸入 OTP');
    await expect(page.locator('#denyList')).toContainText('付款、轉帳或連接錢包');
    await expect(page.locator('#denyList')).toContainText('繳交保證金、稅金或手續費解鎖');

    // 3. 授權單次委任，進入共用 Guardian resultView。
    await page.locator('#consent').check();
    await page.locator('#authorizeBtn').click();
    await expect(page.locator('#resultView')).toHaveClass(/active/);

    // 4. 驗證痛點 2 的決策、HIGH signal 與四層 evidence。
    await expect(page.locator('#resultKicker')).toContainText('PAIN POINT 02');
    await expect(page.locator('#riskScore')).toHaveText('HIGH');
    await expect(page.locator('#riskScoreUnit')).toHaveText('signal');
    await expect(page.locator('#riskBadge')).toHaveText('高風險攔截');
    await expect(page.locator('#verdictTitle')).toHaveText('投資邀請與付款操作已被攔截');
    await expect(page.locator('#evidencePane')).toContainText('疑似六階段詐騙鏈');
    await expect(page.locator('#evidencePane')).toContainText('系統不登入、不輸入 OTP、不付款、不連接錢包');
    for (const evidenceId of ['e01', 'e02', 'e03', 'e04']) {
      await expect(page.locator('#evidencePane')).toContainText(`evidence #${evidenceId}`);
    }

    // 5. Gateway trace 必須包含可供後端 policy engine 對接的拒絕理由。
    await page.locator('.content-tabs button[data-pane="gateway"]').click();
    const trace = JSON.parse(await page.locator('#gatewayTrace').textContent() ?? '{}');
    expect(trace).toMatchObject({
      decision: 'DENY_HIGH_RISK_ACTION',
      policy_version: 'vf-policy-0.2',
      subject_match: true,
      scope_valid: true,
      expiry_valid: true,
      nonce_fresh: true,
      revoked: false,
      reason_codes: [
        'SOCIAL_ENGINEERING_PATTERN',
        'PAYMENT_OR_WALLET_PROHIBITED',
        'HIGH_RETURN_PRESSURE'
      ]
    });
    expect(trace.evidence_hash).toMatch(/^sha256:/);

    // 6. 使用者撤銷後，任何重試都必須變成 DENY，且不能執行工具。
    await page.locator('#revokeTop').click();
    await expect(page.locator('#revokedBanner')).toBeVisible();
    await expect(page.locator('#eventCount')).toHaveText('5');
    await page.locator('#retryTool').click();
    const revokedTrace = JSON.parse(await page.locator('#gatewayTrace').textContent() ?? '{}');
    expect(revokedTrace).toMatchObject({
      decision: 'DENY',
      policy_version: 'vf-policy-0.2',
      revoked: true,
      reason_codes: ['MANDATE_REVOKED'],
      tool_execution: false
    });

    // 7. 此 Demo 不得對付款、錢包、轉帳、OTP 或登入端點發出請求。
    expect(forbiddenRequests).toEqual([]);
  });
});
