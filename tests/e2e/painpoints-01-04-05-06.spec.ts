import { test, expect, type Page } from '@playwright/test';

const guardianPath = '/verifyfirst/';
const forbiddenActionPattern = /(?:payment|pay|wallet|transfer|withdraw|otp|login)/i;

async function choosePathway(page: Page, key: string) {
  await page.goto(guardianPath, { waitUntil: 'domcontentloaded' });
  await page.locator(`.pathway-tab[data-case="${key}"]`).click();
  await page.locator('#prepareBtn').click();
  await expect(page.locator('#mandateView')).toHaveClass(/active/);
}

async function authorize(page: Page) {
  await page.locator('#consent').check();
  await page.locator('#authorizeBtn').click();
  await expect(page.locator('#resultView')).toHaveClass(/active/);
}

test.describe('Trust Pathways · pain points 01/04/05/06', () => {
  test('痛點 1 製造貿易：只揭露碳足跡，禁止製程機密與未確認申報', async ({ page }) => {
    const forbiddenRequests: string[] = [];
    page.on('request', (request) => {
      if (forbiddenActionPattern.test(request.url())) forbiddenRequests.push(request.url());
    });

    await choosePathway(page, 'manufacturing');
    await expect(page.locator('#caseInput')).toHaveValue(/產品碳足跡/);
    await expect(page.locator('#mandateRepresentative')).toHaveText(/宏岳精密/);
    await expect(page.locator('#mandateScope')).toHaveText('單一訂單／產品碳足跡');
    await expect(page.locator('#mandateOutput')).toHaveText('產生申報草稿、不正式送出');
    await expect(page.locator('#allowList')).toContainText('查驗產品碳足跡 VC');
    await expect(page.locator('#denyList')).toContainText('讀取完整配方與能耗明細');
    await expect(page.locator('#denyList')).toContainText('未確認即正式申報');

    await authorize(page);
    await expect(page.locator('#resultKicker')).toContainText('PAIN POINT 01');
    await expect(page.locator('#verdictTitle')).toHaveText('碳排證明可供查驗');
    await expect(page.locator('#gatewayTrace')).toContainText('ALLOW_WITH_MINIMAL_DISCLOSURE');
    await expect(page.locator('#evidencePane')).toContainText('製程資料維持私密');
    await expect(page.locator('#evidencePane')).toContainText('evidence #e04');
    expect(forbiddenRequests).toEqual([]);
  });

  test('痛點 4 政府服務：Agent 可備妥草稿，但正式送件必須本人確認', async ({ page }) => {
    await choosePathway(page, 'government');
    await expect(page.locator('#mandateRepresentative')).toHaveText(/林怡君/);
    await expect(page.locator('#mandateScope')).toHaveText('單一補助資格轉換');
    await expect(page.locator('#mandateOutput')).toHaveText('預填申請草稿、不替本人送件');
    await expect(page.locator('#allowList')).toContainText('預填申請草稿並提醒');
    await expect(page.locator('#denyList')).toContainText('代替本人法律簽署');
    await expect(page.locator('#denyList')).toContainText('未確認即送出申請');

    await authorize(page);
    await expect(page.locator('#verdictTitle')).toHaveText('資格符合，草稿已備妥');
    await expect(page.locator('#gatewayTrace')).toContainText('REQUIRE_HUMAN_CONFIRMATION');
    await expect(page.locator('#evidencePane')).toContainText('不必要個資未讀取');
    await expect(page.locator('#evidencePane')).toContainText('完整所得、醫療資料均未進入流程');
  });

  test('痛點 5 移工數位信任：1:1:1 綁定並拒絕保存完整 ARC 或代借款', async ({ page }) => {
    await choosePathway(page, 'migrant');
    await expect(page.locator('#mandateRepresentative')).toHaveText(/Nguyễn An/);
    await expect(page.locator('#mandateScope')).toHaveText('單一金融服務註冊');
    await expect(page.locator('#mandateOutput')).toHaveText('簽發短效 KYC 憑證、不替本人借款');
    await expect(page.locator('#allowList')).toContainText('執行活體與 FIDO 驗證');
    await expect(page.locator('#allowList')).toContainText('建立短效 KYC 憑證');
    await expect(page.locator('#denyList')).toContainText('保存完整證件影像');
    await expect(page.locator('#denyList')).toContainText('替本人轉帳或借款');

    await authorize(page);
    await expect(page.locator('#verdictTitle')).toHaveText('1:1:1 信任綁定完成');
    await expect(page.locator('#gatewayTrace')).toContainText('ALLOW_CREDENTIAL_ISSUANCE');
    await expect(page.locator('#evidencePane')).toContainText('完整 ARC 影像已捨棄');
    await expect(page.locator('#evidencePane')).toContainText('evidence #e04');
  });

  test('痛點 6 RBA 供應鏈：保留例外人工複核且禁止改寫稽核事件', async ({ page }) => {
    await choosePathway(page, 'rba');
    await expect(page.locator('#mandateRepresentative')).toHaveText(/東海電子/);
    await expect(page.locator('#mandateScope')).toHaveText('RBA-2026-08／36 人批次');
    await expect(page.locator('#mandateOutput')).toHaveText('輸出品牌商合規摘要、不修改事件');
    await expect(page.locator('#allowList')).toContainText('核對費用聲明與退款證明');
    await expect(page.locator('#denyList')).toContainText('自動判定爭議案件無責');
    await expect(page.locator('#denyList')).toContainText('修改或刪除稽核事件');

    await authorize(page);
    await expect(page.locator('#verdictTitle')).toHaveText('35 筆通過，1 筆需人工複核');
    await expect(page.locator('#gatewayTrace')).toContainText('REQUIRE_EXCEPTION_REVIEW');
    await expect(page.locator('#evidencePane')).toContainText('1 筆可能為不當轉嫁');
    await expect(page.locator('#evidencePane')).toContainText('移工身份保持遮罩');
  });
});
