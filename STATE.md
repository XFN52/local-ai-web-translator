# Журнал проекта

## 2026-09-08 — Задача 1
Формулировка задачи: "надо сделать расшрение которое будет рабоать на локальном апи ии, перевод с китайского на русский, должно быть идеальное восстаноление сайта без того чтобы он ломался /ponytail"

### Пункты плана:
1. [x] Создать manifest.json (Manifest V3, разрешения storage, activeTab, host_permissions) и background.js для безопасных HTTP-запросов к локальному OpenAI-совместимому API.
2. [x] Реализовать content.js с обходом DOM через TreeWalker, детекцией китайских иероглифов, пакетным формированием запросов, сохранением оригиналов в WeakMap и безопасной заменой nodeValue.
3. [x] Создать UI управления popup.html и popup.js с кнопками «Перевести» / «Оригинал» и полями настройки адреса API и модели.
4. [x] Написать и выполнить test_dom_translation.js для проверки логики извлечения, батчинга и точного отката.

### Выясненные факты и документация:
- Репозиторий изначально пуст (grep по translate дал 0 совпадений).
- Документация OpenAI compatibility в Ollama: https://ollama.com/blog/openai-compatibility (базовый адрес http://localhost:11434/v1/chat/completions, аутентификация не требуется, формат запроса chat completions).
- [manifest.json:1-34](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/manifest.json#L1-L34): настроен Manifest V3 с разрешениями storage, activeTab, host_permissions для localhost и 127.0.0.1.
- [background.js:6-7](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L6-L7): дефолтный адрес `http://localhost:11434/v1/chat/completions`, модель `qwen2.5:latest`.
- [background.js:29-88](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L29-L88): реализована пакетная трансляция с очисткой markdown code fences и защитой от рассинхронизации длины массива.
- Решение: сетевой обмен вынесен в сервис-воркер фонового процесса для гарантированного обхода CSP/CORS веб-страниц.
- [content.js:8](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L8): фильтрация китайских иероглифов по регулярному выражению `[\u4e00-\u9fa5]`.
- [content.js:11-26](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L11-L26): защитный черный список тегов (SCRIPT, STYLE, PRE, CODE, INPUT и др.) и атрибутов notranslate/translate=no.
- [content.js:29-31](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L29-L31), [content.js:107-119](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L107-L119): сохранение исходных значений текстовых узлов в WeakMap и точное мгновенное восстановление оригинала.
- [content.js:176-179](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L176-L179): точечная мутация исключительно `nodeValue` с сохранением ведущих и замыкающих пробелов, предотвращающая ломку разметки и слушателей событий.
- [popup.html:1-202](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/popup.html#L1-L202), [popup.js:1-115](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/popup.js#L1-L115): интерфейс настроек (URL API, модель, размер батча) и кнопки мгновенного перевода / восстановления оригинала.
## 2026-09-08 — Задача 2
Формулировка задачи: "sk-*** 8045 порт, локально. модель тольок Модель gemini-3.8-flash-high"

### Пункты:
1. [x] Настроить интеграцию с локальным сервером на порту 8045 (http://localhost:8045/v1/chat/completions) и передачу Bearer-токена авторизации.
2. [x] Зафиксировать модель по умолчанию `gemini-3.8-flash-high` во всех компонентах расширения.

### Выясненные факты и проверки:
- [config.js:1-12](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/config.js#L1-L12): создан конфигурационный файл с портом 8045, моделью gemini-3.8-flash-high и токеном.
- [background.js:1-10](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L1-L10), [background.js:52-57](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L52-L57): добавлена поддержка заголовка `Authorization: Bearer <token>` для запросов перевода и проверки соединения.
- [popup.html:173-186](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/popup.html#L173-L186), [popup.js:18-24](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/popup.js#L18-L24): добавлены поле ввода API-ключа, плейсхолдеры и дефолты для gemini-3.8-flash-high.
- [content.js:143-169](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L143-L169): передача apiKey из настроек в фоновый сервис-воркер.
- Живой вызов к `http://127.0.0.1:8045/v1/chat/completions` с моделью `gemini-3.8-flash-high` завершился с кодом HTTP 200, вернув корректный JSON-массив перевода.

## 2026-09-08 — Задача 3
Формулировка задачи: "логи пусть в папку пишет тоже. ЛОГИ МАКСИМАЛЬНО ПОЛЕЗНЫЕ И ПОДРОБНЫЕ ПРИ ДЕБАГЕ ДОЛЖНЫ БЫТЬ"

### Пункты:
1. [x] Реализовать локальный сервер логирования `logger.js` (Node.js, порт 8046), записывающий структурированные логи в папку `logs/translator.log`.
2. [x] Настроить максимально подробный дебаг-формат: сопоставление исходных китайских строк с русским переводом, подсчет пробелов, замеры latency, токенов и ошибок с маскированием ключей `sk-***`.
3. [x] Подключить телеметрию из `content.js` (DOM_SCAN, DOM_MUTATE, DOM_OBSERVER, DOM_RESTORE) и `background.js` (BATCH_REQ, BATCH_DONE, API, NETWORK).
4. [x] Создать демонстрационную страницу `test_page.html` для комплексной проверки перевода, динамического контента и логирования.

### Выясненные факты и проверки:
- [logger.js:23-55](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/logger.js#L23-L55): форматирование логов в наглядные древовидные блоки с сопоставлением `[#id] ZH -> RU` и проверкой пробелов.
- [logs/translator.log:1-21](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/logs/translator.log#L1-L21): подтверждена физическая запись логов на диск в папку проекта.
- [background.js:15-32](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L15-L32), [background.js:63-145](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L63-L145): отправка структурированных пар и метаданных в сервис логирования.
- [content.js:36-52](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L36-L52), [content.js:119-247](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L119-L247): сквозная фиксация сканирования DOM, инкрементального перевода и динамического контента через MutationObserver.
- [test_page.html:1-120](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/test_page.html#L1-L120): тестовая среда с защищенными блоками `<pre><code>` и динамическим добавлением отзывов.
- Тест `node test_dom_translation.js` успешно пройден (код 0).

## 2026-09-08 — Задача 4
Формулировка задачи: "не он должен переводить только то что видно, чтобы квоту не тратить, используй модель лоу"

### Пункты:
1. [x] Реализовать строгий перевод только видимой области экрана (viewport) для радикальной экономии квоты модели.
2. [x] Добавить отложенный перевод при скролле через `IntersectionObserver`: скрытые/нижние элементы переводятся только при приближении к экрану.
3. [x] Установить модель `gemini-3.8-flash-low` по умолчанию во всех файлах проекта.

### Выясненные факты и проверки:
- [content.js:72-100](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L72-L100): функция `isElementInViewport` фильтрует скрытые (`display: none`, `visibility: hidden`) и находящиеся за пределами экрана элементы.
- [content.js:155-230](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L155-L230), [content.js:330-375](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L330-L375): разделение узлов на in-viewport (переводятся сразу) и off-screen (ставятся на учет в IntersectionObserver).
- [config.js:1-7](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/config.js#L1-L7), [background.js:8](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L8), [popup.js:21](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/popup.js#L21): дефолтная модель переключена на `gemini-3.8-flash-low`.
- [test_page.html:125-140](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/test_page.html#L125-L140): добавлен блок ниже первого экрана (below-fold) для проверки экономии квоты при скролле.
- Живой вызов к `http://127.0.0.1:8045/v1/chat/completions` с моделью `gemini-3.8-flash-low` подтвердил статус HTTP 200.

## 2026-09-08 — Задача 5
Формулировка задачи: "ломает он эту страницу"

### Пункты:
1. [x] Проанализировать причины сбоя SPA (React / Semi UI на a6api.com) при инкрементальном переводе.
2. [x] Добавить защиту интерактивных элементов форм и выпадающих списков (SELECT, OPTION, combobox, listbox, x-semi-prop, data-market-filter) в IGNORED_TAGS и isIgnoredElement.
3. [x] Устранить потерю узлов в IntersectionObserver при быстром скролле через внешний накопитель pendingScrollQueue.
4. [x] Добавить проверку `item.node.isConnected` перед модификацией `nodeValue` для защиты от мутации размонтированных React-волокон.

### Выясненные факты и проверки:
- [content.js:16-19](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L16-L19): в IGNORED_TAGS добавлены SELECT, OPTION, OPTGROUP, DATALIST.
- [content.js:72-76](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L72-L76): в isIgnoredElement заблокирован перевод внутренностей combobox, listbox, semi-select, x-semi-prop, предотвращающий падение и рассинхронизацию фильтров Semi UI.
- [content.js:170-209](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L170-L209): очередь pendingScrollQueue вынесена за пределы колбэка IntersectionObserver с гарантией сохранения очереди при дебаунсе.
- [content.js:364](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L364): проверка `item.node.isConnected` исключает изменение отсоединенных узлов React.
- Тест `node test_dom_translation.js` с проверкой исключения SELECT/OPTION и COMBOBOX успешно пройден (код 0).

## 2026-09-08 — Задача 6
Формулировка задачи: "также он автоматически должен детектить появление элементов"

### Пункты:
1. [x] Расширить `MutationObserver` для отслеживания не только вставки элементов (`childList`), но и обновления текста на месте (`characterData`) и переключения видимости элементов (`attributes`: style, class, open, hidden, aria-hidden).
2. [x] Добавить отслеживание навигации в SPA-приложениях (`popstate`, `hashchange`) с автоматическим переводом новых экранов и представлений.
3. [x] Добавить интерактивные элементы проверки переключения видимости (details/summary и скрытый блок) в `test_page.html`.

### Выясненные факты и проверки:
- [content.js:284-303](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L284-L303): обработка `characterData` автоматически переводит обновленный React/Vue текст при пагинации или динамическом рендере, исключая зацикливание на русском тексте.
- [content.js:304-320](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L304-L320): обработка `attributes` (open, style, class, hidden) автоматически захватывает раскрытые аккордеоны, модальные окна и вкладки.
- [content.js:376-414](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L376-L414): функции `startObservingSpaNavigation` и `stopObservingSpaNavigation` обеспечивают автоматический подхват перевода при переходах по SPA-маршрутам.
- [test_page.html:129-140](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/test_page.html#L129-L140): добавлены элементы `<details>` и всплывающего блока для тестирования динамического появления.
- Тест `node test_dom_translation.js` успешно пройден (код 0).

## 2026-09-08 — Задача 7
Формулировка задачи: "вот эти штуки ломаются , не закрываются, верх ломается, уезжает вправо"

### Пункты:
1. [x] Устранить зависание открытых выпадающих списков Semi UI (`.semi-portal`, `.semi-popover`, `.semi-select-option`, `data-popupid`) через полную изоляцию от перевода в `isIgnoredElement`.
2. [x] Устранить наложение кнопок верхней навигации друг на друга ("верх ломается") через внедрение динамических правил CSS-компоновки (`display: flex`, `gap: 8px`, `width: auto`, `min-width: max-content`).
3. [x] Устранить горизонтальное выпирание строк таблицы вправо ("уезжает вправо") через правила сжатия кнопок действий (`.marketplace-actions`) и директиву компактности перевода в системном промпте модели.

### Выясненные факты и проверки:
- [content.js:71-85](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L71-L85): исключение порталов, поповеров и элементов опций Semi UI сохраняет внутреннее состояние селектов и восстанавливает закрытие меню при клике.
- [content.js:89-138](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L89-L138): функция `injectLayoutProtectionStyles` динамически нормализует геометрию `.topbar nav button` и `.expand-summary`, предотвращая наслоение шапки и горизонтальный сдвиг строк.
- [background.js:77](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L77): системный промпт дополнен правилом `UI CONCISENESS & COMPACTNESS`, ограничивающим длину переводов кнопок и тегов (1-2 коротких слова вместо предложений).
- Тест `node test_dom_translation.js` с проверкой порталов и поповеров успешно пройден (код 0).

## 2026-09-08 — Задача 8
Формулировка задачи: "кэш добавь"

### Пункты:
1. [x] Реализовать постоянный кэш переводов в `background.js` с поддержкой `chrome.storage.local` и ограничением по объему (LRU до 5000 записей).
2. [x] Внедрить дедупликацию строк внутри пачек: одинаковые китайские строки в батче отправляются в AI только один раз, а результат проецируется на все позиции.
3. [x] Добавить мгновенный локальный кэш `pageCache` в `content.js` для повторных узлов без лишних IPC-сообщений.
4. [x] Добавить отображение статистики кэша и кнопку «Очистить кэш» в интерфейс `popup.html` / `popup.js`.
5. [x] Расширить набор тестов `test_dom_translation.js` проверками 100% cache hit, частичного кэша, дедупликации дубликатов и вытеснения по LRU.

### Выясненные факты и проверки:
- [background.js:47-97](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L47-L97): реализованы `translationCache`, `loadCache` и отложенное сохранение `scheduleSaveCache` в `chrome.storage.local`.
- [background.js:183-234](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L183-L234): функция `translateBatch` проверяет кэш перед отправкой запроса к AI; при 100% совпадении возвращает перевод с 0ms задержкой и нулевым расходом квоты; при частичном — отправляет только `uniqueMissing` строки.
- [background.js:256-276](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/background.js#L256-L276): добавлены обработчики сообщений `GET_CACHE_STATS` и `CLEAR_CACHE`.
- [content.js:36](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L36), [content.js:498-518](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L498-L518): `pageCache` синхронно переводит повторяющиеся узлы на странице, предотвращая отправку лишних фоновых запросов.
- [popup.html:193-196](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/popup.html#L193-L196), [popup.js:71-83](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/popup.js#L71-L83): отображение размера кэша и кнопка его сброса в панели настроек.
- [test_dom_translation.js:188-303](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/test_dom_translation.js#L188-L303): добавлены и успешно пройдены тесты дедупликации, 100% попадания в кэш, частичного кэша и LRU-вытеснения.
- Команда `node test_dom_translation.js` завершилась с кодом 0: все тесты пройдены.

## 2026-09-08 — Задача 9
Формулировка задачи: "еще когда по вкладкам шарахаешься, там перевод слетает"

### Пункты:
1. [x] Перехватить методы `history.pushState` и `history.replaceState` с генерацией события `locationchange` для отслеживания всех переходов по SPA-маршрутам.
2. [x] Внедрить делегированный слушатель кликов на навигационные элементы (`[role="tab"]`, `[data-page]`, `.console-side-item`, `.topbar nav button` и др.) для упреждающего повторного сканирования вьюпорта.
3. [x] Добавить обработчики событий `visibilitychange` и `focus` для мгновенного подхвата элементов при переключении между вкладками браузера и подавления сброса от React Query / SWR.
4. [x] Устранить отсечение анимированных вкладок в `isElementInViewport` (снято условие `opacity === "0"`) и сбросить `activeNodes` для узлов с китайским текстом при повторном рендере React.
5. [x] Добавить сессионное сохранение активности перевода (`sessionStorage`) для бесшовного продолжения перевода при перезагрузках и переходах внутри домена.
6. [x] Снизить задержки дебаунса с 300ms до 80ms и добавить тесты устойчивости вкладок в `test_dom_translation.js`.

### Выясненные факты и проверки:
- [content.js:166-170](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L166-L170): удалено условие `opacity === "0"` в `isElementInViewport`, благодаря чему панели с плавной CSS-анимацией не отбрасываются как закадровые.
- [content.js:219](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L219): вызов `activeNodes.delete(currentNode)` при обнаружении Han-символов гарантирует повторный перевод узлов, перезаписанных React VDOM при переключении табов.
- [content.js:485-503](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L485-L503): функция `patchHistory` перехватывает `pushState` / `replaceState`, генерируя событие `locationchange`.
- [content.js:512-550](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L512-L550): слушатели кликов по табам, `locationchange`, `popstate`, `hashchange`, `visibilitychange` и `focus` с многократным каскадным `scheduleReScan(50/200/500ms)`.
- [content.js:686-688](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L686-L688), [content.js:759-761](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L759-L761), [content.js:915-927](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L915-L927): поддержка авто-возобновления перевода через `sessionStorage`.
- [test_dom_translation.js:301-342](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/test_dom_translation.js#L301-L342): добавлен и успешно пройден тест переключения табов и повторного рендера React.
- Запуск `node test_dom_translation.js` завершился с кодом 0.

## 2026-09-08 — Задача 10
Формулировка задачи: "вот эти штуки в опервых не переводятся а во вторых не закрываются после открытия. вот эти штуки при наведении тоже не переводятся"

### Пункты:
1. [x] Разрешить перевод выпадающих списков Semi UI (селектов и опций): снято избыточное блокирование `role="combobox"`, `role="listbox"`, `role="option"`, `[x-semi-prop]`, `[data-market-filter]`, `.semi-select*`, `.semi-portal*`, `.semi-popover*` в `isIgnoredElement`.
2. [x] Устранить зависание открытых выпадающих списков: удалено конфликтное правило `.semi-portal { z-index: 2147483646 !important; }` и внедрен глобальный обработчик `closeAllOpenPortals` на фазе захвата `pointerdown`, вызывающий методы `close()` и `hide()` React-компонентов Semi UI при клике вне открытого меню или переключении на другой селект.
3. [x] Реализовать сбор и перевод атрибутов всплывающих подсказок (`TRANSLATABLE_ATTRS = ["data-tooltip", "data-title", "data-tip", "title", "placeholder", "aria-label"]`) в `collectChineseAttributes`, включая наблюдение мутаций атрибутов в `MutationObserver`.
4. [x] Реализовать 100% точный откат атрибутов к оригинальным китайским значениям в `restoreOriginal` через `originalAttrMap`.
5. [x] Расширить набор модульных тестов `test_dom_translation.js` проверками перевода/отката селектов и атрибутов `data-tooltip` и `placeholder`.

### Выясненные факты и проверки:
- [content.js:34-42](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L34-L42): добавлены `originalAttrMap = new WeakMap()`, `activeAttrElements = new Set()` и список `TRANSLATABLE_ATTRS`.
- [content.js:63-88](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L63-L88): из `isIgnoredElement` убран запрет на интерактивные компоненты Semi UI, сохранена только базовая изоляция служебных тегов (`SCRIPT`, `STYLE`, `INPUT`, native `SELECT` и др.).
- [content.js:144-146](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L144-L146): удалено правило `z-index: 2147483646 !important` для `.semi-portal`, восстановив штатное наложение слоев в Semi UI.
- [content.js:240-300](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L240-L300): функция `collectChineseAttributes` извлекает атрибуты подсказок, а `closeAllOpenPortals` на фазе capture гарантирует закрытие предыдущих открытых селектов при клике вне меню или смене фильтра.
- [content.js:847-865](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/content.js#L847-L865): функция `restoreOriginal` полностью возвращает как текстовые узлы, так и атрибуты в исходное китайское состояние.
- [test_dom_translation.js:80-199](file:///c:/Users/site/Documents/antigravity/gallant-heisenberg/test_dom_translation.js#L80-L199): тесты сбора, перевода и 100% отката `data-tooltip`, `placeholder`, combobox и опций портала пройдены успешно.
- Команда `node test_dom_translation.js` завершилась с кодом 0.



