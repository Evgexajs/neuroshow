import { test, expect, type Page } from '@playwright/test';

// Mock data for templates
const mockTemplates = [
  {
    id: 'coalition',
    name: 'Коалиция',
    description: '5 персонажей соревнуются за один приз.',
    minParticipants: 5,
    maxParticipants: 5,
    phases: [],
  },
  {
    id: 'debate',
    name: 'Дебаты',
    description: '2-4 участника обсуждают спорный вопрос.',
    minParticipants: 2,
    maxParticipants: 4,
    phases: [],
  },
];

// Mock data for characters
const mockCharacters = [
  {
    id: 'char-1',
    name: 'Алексей Громов',
    publicCard: 'Опытный бизнесмен, владелец сети ресторанов.',
    privateCard: 'Готов подставить других ради своей выгоды.',
    modelAdapterId: 'openai',
  },
  {
    id: 'char-2',
    name: 'Марина Светлова',
    publicCard: 'Психолог с 15-летним стажем.',
    privateCard: 'Собирает компромат на всех.',
    modelAdapterId: 'openai',
  },
  {
    id: 'char-3',
    name: 'Дмитрий Волков',
    publicCard: 'Молчаливый программист.',
    privateCard: 'Хочет отомстить Громову.',
    modelAdapterId: 'openai',
  },
  {
    id: 'char-4',
    name: 'Елена Краснова',
    publicCard: 'Яркая журналистка.',
    privateCard: 'Любит провокации и скандалы.',
    modelAdapterId: 'openai',
  },
  {
    id: 'char-5',
    name: 'Игорь Петров',
    publicCard: 'Бывший военный.',
    privateCard: 'Скрывает своё прошлое.',
    modelAdapterId: 'openai',
  },
];

// Mock generated characters (from /generate/characters endpoint)
// Use UUID-like IDs to simulate generated characters
// secretMission is an object with type, description, and optional targetIds
const mockGeneratedCharacters = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'Сергей Новиков',
    publicCard: 'Амбициозный предприниматель из Сибири.',
    privateCard: 'Готов на всё ради успеха.',
    modelAdapterId: 'openai',
    startingPrivateContext: {
      secretMission: {
        type: 'discredit',
        description: 'Убедить всех, что Виктор — ненадёжный партнёр',
        targetIds: ['c3d4e5f6-a7b8-9012-cdef-345678901234'],
      },
    },
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
    name: 'Анна Морозова',
    publicCard: 'Талантливый архитектор.',
    privateCard: 'Скрывает провал прошлого проекта.',
    modelAdapterId: 'openai',
    startingPrivateContext: {
      secretMission: {
        type: 'alliance',
        description: 'Заключить тайный союз минимум с двумя участниками',
      },
    },
  },
  {
    id: 'c3d4e5f6-a7b8-9012-cdef-345678901234',
    name: 'Виктор Козлов',
    publicCard: 'Бывший спортсмен.',
    privateCard: 'Ищет новый смысл жизни.',
    modelAdapterId: 'openai',
    startingPrivateContext: {
      secretMission: {
        type: 'investigate',
        description: 'Выяснить, кто распространяет слухи о твоём прошлом',
      },
    },
  },
  {
    id: 'd4e5f6a7-b8c9-0123-defa-456789012345',
    name: 'Ольга Белова',
    publicCard: 'Успешный адвокат.',
    privateCard: 'Знает слишком много чужих секретов.',
    modelAdapterId: 'openai',
    startingPrivateContext: {
      secretMission: {
        type: 'blackmail',
        description: 'Шантажировать одного из участников',
      },
    },
  },
  {
    id: 'e5f6a7b8-c9d0-1234-efab-567890123456',
    name: 'Павел Сидоров',
    publicCard: 'Известный художник.',
    privateCard: 'Творческий кризис длится годы.',
    modelAdapterId: 'openai',
    startingPrivateContext: {
      secretMission: {
        type: 'provoke',
        description: 'Найти вдохновение через конфликт',
      },
    },
  },
];

// Mock relationships
const mockRelationships = [
  {
    id: 'rel-1',
    type: 'ally',
    participantIds: ['gen-1', 'gen-2'],
    visibility: 'private',
    description: 'Старые деловые партнёры',
    knownBy: ['gen-1', 'gen-2'],
  },
  {
    id: 'rel-2',
    type: 'rival',
    participantIds: ['gen-1', 'gen-3'],
    visibility: 'public',
    description: 'Конкуренты в бизнесе',
    knownBy: ['gen-1', 'gen-3'],
  },
];


/**
 * Set up API mocks for the page
 */
async function setupApiMocks(page: Page) {
  // Mock GET /templates
  await page.route('**/templates', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockTemplates),
    });
  });

  // Mock GET /characters
  await page.route('**/characters', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockCharacters),
    });
  });

  // Mock POST /generate/characters
  await page.route('**/generate/characters', async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();

    // Characters already have secretMission in startingPrivateContext
    const response: {
      characters: typeof mockGeneratedCharacters;
      relationships?: typeof mockRelationships;
    } = {
      characters: mockGeneratedCharacters,
    };

    // Add relationships if requested
    if (postData?.generateRelationships) {
      response.relationships = mockRelationships;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // Mock POST /shows
  await page.route('**/shows', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          showId: 'mock-show-123',
          status: 'created',
        }),
      });
    } else {
      // GET /shows - return empty list
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shows: [] }),
      });
    }
  });

  // Mock show-related endpoints that may be called after creation
  await page.route('**/shows/*/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        templateId: 'coalition',
        templateName: 'Коалиция',
        participantCount: 5,
      }),
    });
  });

  await page.route('**/shows/*/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'created',
        phase: null,
        tokenBudget: { limit: 100000, used: 0 },
      }),
    });
  });

  // Mock SSE events endpoint - return empty and close
  await page.route('**/shows/*/events', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });
}

test.describe('Create New Show Popup', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/debug-ui/index.html');
  });

  test('opens modal when clicking New Show button', async ({ page }) => {
    // Find and click the New Show button
    const newShowBtn = page.locator('#new-show-btn');
    await expect(newShowBtn).toBeVisible();
    await newShowBtn.click();

    // Modal should be visible
    const modal = page.locator('#new-show-modal');
    await expect(modal).toBeVisible();
    await expect(modal).not.toHaveClass(/hidden/);

    // Modal header should show correct title
    const modalHeader = page.locator('#new-show-modal .modal-header h2');
    await expect(modalHeader).toHaveText('Create New Show');
  });

  test('closes modal when clicking close button', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();
    const modal = page.locator('#new-show-modal');
    await expect(modal).toBeVisible();

    // Click close button
    await page.locator('#modal-close-btn').click();

    // Modal should be hidden
    await expect(modal).toHaveClass(/hidden/);
  });

  test('closes modal when clicking Cancel button', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();
    const modal = page.locator('#new-show-modal');
    await expect(modal).toBeVisible();

    // Click Cancel button
    await page.locator('#cancel-btn').click();

    // Modal should be hidden
    await expect(modal).toHaveClass(/hidden/);
  });

  test('closes modal when clicking overlay', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();
    const modal = page.locator('#new-show-modal');
    await expect(modal).toBeVisible();

    // Click overlay (outside modal content)
    await page.locator('#modal-overlay').click({ position: { x: 10, y: 10 } });

    // Modal should be hidden
    await expect(modal).toHaveClass(/hidden/);
  });

  test('loads and displays templates in dropdown', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Wait for templates to load
    const templateSelect = page.locator('#template-select');
    await expect(templateSelect).toBeVisible();

    // Check templates are loaded
    const options = templateSelect.locator('option');
    // First option is placeholder + 2 templates
    await expect(options).toHaveCount(3);

    // Verify template names
    await expect(options.nth(1)).toHaveText('Коалиция');
    await expect(options.nth(2)).toHaveText('Дебаты');
  });

  test('shows template info when template is selected', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select a template
    const templateSelect = page.locator('#template-select');
    await templateSelect.selectOption('coalition');

    // Template info should be displayed
    const templateInfo = page.locator('#template-info');
    await expect(templateInfo).toBeVisible();
    await expect(templateInfo).toContainText('5 персонажей соревнуются');
  });

  test('loads and displays characters as checkboxes', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select a template first (to enable character section)
    await page.locator('#template-select').selectOption('coalition');

    // Wait for characters to load
    const charactersList = page.locator('#characters-list');
    await expect(charactersList).toBeVisible();

    // Check that character checkboxes are rendered
    const characterItems = charactersList.locator('.character-item');
    await expect(characterItems).toHaveCount(5);

    // Verify first character name (target main checkbox label, not option labels)
    const firstCharacterLabel = characterItems.first().locator('label.character-checkbox');
    await expect(firstCharacterLabel).toContainText('Алексей Громов');
  });

  test('validates character selection against template limits', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select coalition template (requires exactly 5 participants)
    await page.locator('#template-select').selectOption('coalition');

    // Select only 3 characters
    const charactersList = page.locator('#characters-list');
    const checkboxes = charactersList.locator('.character-checkbox');

    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await checkboxes.nth(2).check();

    // Create button should be disabled due to validation
    const createBtn = page.locator('#create-show-btn');
    await expect(createBtn).toBeDisabled();

    // Validation message should show
    const validationMsg = page.locator('#characters-validation');
    await expect(validationMsg).toBeVisible();
    await expect(validationMsg).toContainText('5');
  });

  test('enables Create button when correct number of characters selected', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select coalition template (requires exactly 5 participants)
    await page.locator('#template-select').selectOption('coalition');

    // Select all 5 characters
    const charactersList = page.locator('#characters-list');
    const checkboxes = charactersList.locator('.character-checkbox');

    for (let i = 0; i < 5; i++) {
      await checkboxes.nth(i).check();
    }

    // Create button should be enabled
    const createBtn = page.locator('#create-show-btn');
    await expect(createBtn).toBeEnabled();
  });

  test('generates characters when clicking Generate button', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select a template
    await page.locator('#template-select').selectOption('coalition');

    // Click Generate button
    const generateBtn = page.locator('#generate-btn');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // Wait for generated characters to appear (5 original + 5 generated = 10)
    const charactersList = page.locator('#characters-list');
    await expect(charactersList.locator('.character-item')).toHaveCount(10);

    // Verify generated character name appears
    await expect(charactersList).toContainText('Сергей Новиков');
  });

  test('generates characters with theme input', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select a template
    await page.locator('#template-select').selectOption('coalition');

    // Enter a theme
    const themeInput = page.locator('#theme-input');
    await themeInput.fill('Космическая станция');

    // Click Generate button
    await page.locator('#generate-btn').click();

    // Characters should be generated (5 original + 5 generated = 10)
    const charactersList = page.locator('#characters-list');
    await expect(charactersList.locator('.character-item')).toHaveCount(10);
  });

  test('generates relationships when checkbox is enabled', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select a template
    await page.locator('#template-select').selectOption('coalition');

    // Enable relationships generation
    const relationshipsCheckbox = page.locator('#generate-relationships-checkbox');
    await relationshipsCheckbox.check();

    // Click Generate button
    await page.locator('#generate-btn').click();

    // Wait for characters to appear (5 original + 5 generated = 10)
    await expect(page.locator('#characters-list .character-item')).toHaveCount(10);

    // Relationships section should be visible
    const relationshipsSection = page.locator('#relationships-list');
    await expect(relationshipsSection).toBeVisible();
    await expect(relationshipsSection).toContainText('Старые деловые партнёры');
  });

  test('generates secret missions when checkbox is enabled', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select a template
    await page.locator('#template-select').selectOption('coalition');

    // Enable secret missions generation
    const missionsCheckbox = page.locator('#generate-missions-checkbox');
    await missionsCheckbox.check();

    // Click Generate button
    await page.locator('#generate-btn').click();

    // Wait for characters to appear (5 original + 5 generated = 10)
    await expect(page.locator('#characters-list .character-item')).toHaveCount(10);

    // Secret missions section should be visible (missions are in startingPrivateContext.secretMission)
    const missionsSection = page.locator('#secret-missions-list');
    await expect(missionsSection).toBeVisible();
    await expect(missionsSection).toContainText('Убедить всех');
  });

  test('per-character relationships toggle works', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select a template and generate characters with relationships
    await page.locator('#template-select').selectOption('coalition');
    await page.locator('#generate-relationships-checkbox').check();
    await page.locator('#generate-btn').click();

    // Wait for characters (5 original + 5 generated = 10)
    await expect(page.locator('#characters-list .character-item')).toHaveCount(10);

    // Find per-character relationship toggle on first character
    const characterItems = page.locator('#characters-list .character-item');
    const firstCharacter = characterItems.first();

    // Check the main character checkbox first (use input inside label)
    await firstCharacter.locator('label.character-checkbox input').check();

    // Find and toggle the relationships option (first option checkbox input)
    const relationshipsToggle = firstCharacter.locator('label.character-option-checkbox input').first();
    await expect(relationshipsToggle).toBeVisible();

    // Toggle should be checkable
    await relationshipsToggle.check();
    await expect(relationshipsToggle).toBeChecked();

    await relationshipsToggle.uncheck();
    await expect(relationshipsToggle).not.toBeChecked();
  });

  test('per-character missions toggle works', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select a template and generate characters with missions
    await page.locator('#template-select').selectOption('coalition');
    await page.locator('#generate-missions-checkbox').check();
    await page.locator('#generate-btn').click();

    // Wait for characters (5 original + 5 generated = 10)
    await expect(page.locator('#characters-list .character-item')).toHaveCount(10);

    // Find per-character missions toggle on first character
    const characterItems = page.locator('#characters-list .character-item');
    const firstCharacter = characterItems.first();

    // Check the main character checkbox first (use input inside label)
    await firstCharacter.locator('label.character-checkbox input').check();

    // Find and toggle the missions option (second option checkbox input)
    const missionsToggle = firstCharacter.locator('label.character-option-checkbox input').nth(1);
    await expect(missionsToggle).toBeVisible();

    // Toggle should be checkable
    await missionsToggle.check();
    await expect(missionsToggle).toBeChecked();
  });

  test('creates show successfully', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select template
    await page.locator('#template-select').selectOption('coalition');

    // Select all 5 characters
    const checkboxes = page.locator('#characters-list .character-checkbox');
    for (let i = 0; i < 5; i++) {
      await checkboxes.nth(i).check();
    }

    // Click Create button
    const createBtn = page.locator('#create-show-btn');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Modal should close after successful creation
    const modal = page.locator('#new-show-modal');
    await expect(modal).toHaveClass(/hidden/);
  });

  test('creates show with generated characters', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select template
    await page.locator('#template-select').selectOption('coalition');

    // Generate characters
    await page.locator('#generate-btn').click();
    // Wait for characters (5 original + 5 generated = 10)
    await expect(page.locator('#characters-list .character-item')).toHaveCount(10);

    // Generated characters are auto-selected, so Create button should be enabled
    // (coalition requires exactly 5 participants, and 5 are auto-selected)
    const createBtn = page.locator('#create-show-btn');
    await expect(createBtn).toBeEnabled();

    // Create show
    await createBtn.click();

    // Modal should close
    await expect(page.locator('#new-show-modal')).toHaveClass(/hidden/);
  });

  test('token budget input accepts valid values', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Find token budget input
    const tokenBudgetInput = page.locator('#token-budget-input');
    await expect(tokenBudgetInput).toBeVisible();

    // Enter valid token budget
    await tokenBudgetInput.fill('50000');
    await expect(tokenBudgetInput).toHaveValue('50000');
  });

  test('full flow: generate with options, select, and create', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // 1. Select template
    await page.locator('#template-select').selectOption('coalition');

    // 2. Set token budget
    await page.locator('#token-budget-input').fill('100000');

    // 3. Enter theme
    await page.locator('#theme-input').fill('Научная экспедиция в Антарктиде');

    // 4. Enable relationship and mission generation
    await page.locator('#generate-relationships-checkbox').check();
    await page.locator('#generate-missions-checkbox').check();

    // 5. Generate characters
    await page.locator('#generate-btn').click();

    // Wait for generation to complete (5 original + 5 generated = 10)
    await expect(page.locator('#characters-list .character-item')).toHaveCount(10);

    // 6. Verify relationships were generated
    await expect(page.locator('#relationships-list')).toBeVisible();

    // 7. Verify secret missions were generated
    await expect(page.locator('#secret-missions-list')).toBeVisible();

    // 8. Generated characters are auto-selected (5 selected = valid for coalition)
    // Create button should already be enabled
    const createBtn = page.locator('#create-show-btn');
    await expect(createBtn).toBeEnabled();

    // 9. Create show
    await createBtn.click();

    // 10. Modal should close
    await expect(page.locator('#new-show-modal')).toHaveClass(/hidden/);
  });

  test('debate template allows 2-4 participants', async ({ page }) => {
    // Open modal
    await page.locator('#new-show-btn').click();

    // Select debate template (2-4 participants)
    await page.locator('#template-select').selectOption('debate');

    // Select 2 characters (minimum)
    const checkboxes = page.locator('#characters-list .character-checkbox');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    // Create button should be enabled with 2 participants
    const createBtn = page.locator('#create-show-btn');
    await expect(createBtn).toBeEnabled();

    // Add 2 more (total 4, maximum)
    await checkboxes.nth(2).check();
    await checkboxes.nth(3).check();

    // Still enabled with 4
    await expect(createBtn).toBeEnabled();

    // Add 5th (exceeds maximum)
    await checkboxes.nth(4).check();

    // Should be disabled now
    await expect(createBtn).toBeDisabled();

    // Validation message should show
    const validationMsg = page.locator('#characters-validation');
    await expect(validationMsg).toBeVisible();
  });
});
