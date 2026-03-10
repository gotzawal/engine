# PlayCanvas WebGPU 전용: 엔진 포크부터 배포까지

---

## 0. 전제 조건

- Node.js 18+, npm
- Git
- Chrome 121+ 또는 Firefox 141+ (WebGPU 지원 브라우저)

---

## 1. 엔진 포크 및 빌드

```bash
# 상위 디렉토리에 엔진 클론
git clone https://github.com/playcanvas/engine.git
cd engine
npm install
npm run build
```

빌드 산출물 (`build/` 디렉토리):

- `playcanvas/src/index.js` -- 릴리스 (모듈별 소스 구조 유지)
- `playcanvas.dbg/src/index.js` -- 디버그 (assert, 상세 에러 메시지)
- `playcanvas.mjs` -- 단일 ESM 번들
- `playcanvas.d.ts` -- TypeScript 선언

**엔진 소스를 직접 수정하며 개발할 때는 빌드가 필요 없다.** Vite가 `src/index.js`를 직접 해석한다 (3단계 참조).

---

## 2. 게임 프로젝트 생성

```bash
cd ..
mkdir my-game && cd my-game
npm init -y
npm install vite --save-dev
```

### 폴더 구조

```
my-game/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   └── main.ts
└── public/
    ├── models/          # GLB 파일
    ├── textures/        # 이미지
    └── libs/            # WebGPU WASM
        ├── glslang/
        │   └── glslang.js
        └── twgsl/
            └── twgsl.js
```

`public/libs/`의 glslang/twgsl 파일은 엔진이 GLSL 셰이더를 WGSL로 변환할 때 필요하다. 엔진 레포의 `examples/assets/lib/` 또는 CDN에서 복사한다:

```bash
mkdir -p public/libs/glslang public/libs/twgsl
cp ../engine/examples/assets/lib/glslang/glslang.js public/libs/glslang/
cp ../engine/examples/assets/lib/twgsl/twgsl.js public/libs/twgsl/
```

### package.json

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:engine": "cross-env ENGINE_PATH=../engine vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "cross-env": "^7.0.3"
  }
}
```

`npm run dev` -- npm 패키지 사용 (빠른 시작, 엔진 수정 불가)
`npm run dev:engine` -- 로컬 엔진 소스 사용 (엔진 수정 즉시 반영)

### index.html

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>PlayCanvas WebGPU</title>
  <style>body { margin: 0; overflow: hidden; }</style>
</head>
<body>
  <canvas id="app"></canvas>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

---

## 3. Vite 설정

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

const ENGINE_PATH = process.env.ENGINE_PATH;

export default defineConfig({
    resolve: {
        alias: ENGINE_PATH
            ? { 'playcanvas': path.resolve(ENGINE_PATH, 'src/index.js') }
            : {}
    },
    server: {
        port: 5173
    },
    build: {
        target: 'esnext',
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    playcanvas: ['playcanvas']
                }
            }
        }
    },
    optimizeDeps: {
        ...(ENGINE_PATH ? { exclude: ['playcanvas'] } : {})
    }
});
```

핵심:

- `ENGINE_PATH` 설정 시 Vite가 npm 패키지 대신 엔진 소스 디렉토리를 직접 참조한다
- `optimizeDeps.exclude` -- 엔진 소스를 Vite의 사전 번들링에서 제외해야 개별 모듈 단위 HMR이 동작한다
- `manualChunks` -- 프로덕션 빌드 시 엔진을 별도 청크로 분리하여 브라우저 캐시 활용

---

## 4. TypeScript 설정

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

PlayCanvas npm 패키지가 `.d.ts`를 내장하고 있어 별도 타입 패키지가 필요 없다. `ENGINE_PATH`로 소스를 직접 가리킬 때도 엔진 소스에 JSDoc 타입 어노테이션이 있어 IntelliSense가 동작한다.

---

## 5. 앱 진입점 -- WebGPU 전용

```typescript
// src/main.ts
import {
    AppBase, AppOptions, createGraphicsDevice,
    Mouse, Keyboard, TouchDevice, platform,
    RenderComponentSystem, CameraComponentSystem,
    LightComponentSystem, ScriptComponentSystem,
    TextureHandler, ContainerHandler, ScriptHandler,
    Entity, Color, StandardMaterial, Asset, AssetListLoader,
    CameraFrame, MiniStats,
    FILLMODE_FILL_WINDOW, RESOLUTION_AUTO,
    TONEMAP_NEUTRAL
} from 'playcanvas';

async function main() {
    const canvas = document.getElementById('app') as HTMLCanvasElement;

    // -- WebGPU 디바이스 생성 (WebGL 폴백 없음) --
    const device = await createGraphicsDevice(canvas, {
        deviceTypes: ['webgpu'],
        glslangUrl: '/libs/glslang/glslang.js',
        twgslUrl: '/libs/twgsl/twgsl.js'
    });

    // -- AppBase 초기화 (필요한 시스템만 등록) --
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.mouse = new Mouse(canvas);
    options.keyboard = new Keyboard(window);
    options.touch = platform.touch ? new TouchDevice(canvas) : null;

    options.componentSystems = [
        RenderComponentSystem,
        CameraComponentSystem,
        LightComponentSystem,
        ScriptComponentSystem
    ];
    options.resourceHandlers = [
        TextureHandler,
        ContainerHandler,
        ScriptHandler
    ];

    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(RESOLUTION_AUTO);
    app.start();

    window.addEventListener('resize', () => app.resizeCanvas());

    // -- MiniStats (디버깅 오버레이) --
    const miniStats = new MiniStats(app);

    // -- 씬 구성 --
    setupScene(app);
}

function setupScene(app: AppBase) {
    // ---- 카메라 ----
    const camera = new Entity('Camera');
    camera.addComponent('camera', {
        clearColor: new Color(0.08, 0.08, 0.12),
        fov: 60,
        nearClip: 0.1,
        farClip: 1000
    });
    camera.setPosition(0, 3, 8);
    camera.setEulerAngles(-15, 0, 0);
    app.root.addChild(camera);

    // ---- 포스트프로세싱 ----
    const cf = new CameraFrame(app, camera.camera!);
    cf.rendering.toneMapping = TONEMAP_NEUTRAL;

    cf.bloom.enabled = true;
    cf.bloom.intensity = 0.02;

    cf.ssao.type = 'sao';
    cf.ssao.intensity = 0.5;
    cf.ssao.radius = 30;
    cf.ssao.samples = 12;

    cf.taa.enabled = true;
    cf.taa.jitter = 1.0;

    cf.update();

    // ---- 디렉셔널 라이트 ----
    const sun = new Entity('Sun');
    sun.addComponent('light', {
        type: 'directional',
        color: new Color(1, 0.95, 0.9),
        intensity: 1.2,
        castShadows: true,
        shadowResolution: 2048
    });
    sun.setEulerAngles(45, 30, 0);
    app.root.addChild(sun);

    // ---- PBR 머티리얼 ----
    const mat = new StandardMaterial();
    mat.useMetalness = true;
    mat.diffuse = new Color(0.8, 0.15, 0.15);
    mat.metalness = 0.7;
    mat.gloss = 0.4;
    mat.glossInvert = true;    // roughness 해석
    mat.update();

    // ---- 박스 ----
    const box = new Entity('Box');
    box.addComponent('render', { type: 'box', castShadows: true });
    box.setPosition(0, 0.5, 0);
    box.render!.meshInstances[0].material = mat;
    app.root.addChild(box);

    // ---- 바닥 ----
    const floor = new Entity('Floor');
    floor.addComponent('render', { type: 'plane' });
    floor.setLocalScale(20, 1, 20);
    app.root.addChild(floor);

    // ---- 업데이트 루프 ----
    app.on('update', (dt: number) => {
        box.rotate(0, 30 * dt, 0);
    });
}

main().catch(console.error);
```

---

## 6. GLB 모델 로딩

`public/models/` 에 GLB 파일을 넣고:

```typescript
// 단일 모델 로딩
app.assets.loadFromUrl('/models/scene.glb', 'container', (err, asset) => {
    if (err || !asset) { console.error(err); return; }
    const entity = asset.resource.instantiateRenderEntity({
        castShadows: true
    });
    app.root.addChild(entity);
});
```

```typescript
// 여러 에셋 프리로딩 (async/await)
const assets = {
    scene: new Asset('scene', 'container', {
        url: '/models/scene.glb',
        filename: 'scene.glb'       // container 타입에 filename 필수
    }),
    character: new Asset('char', 'container', {
        url: '/models/character.glb',
        filename: 'character.glb'
    })
};

const loader = new AssetListLoader(Object.values(assets), app.assets);
await new Promise<void>(resolve => loader.load(resolve));

const sceneEntity = assets.scene.resource.instantiateRenderEntity();
app.root.addChild(sceneEntity);
```

---

## 7. 개발 실행과 디버깅

### 개발 서버 시작

```bash
# npm 패키지 사용 (엔진 수정 불필요 시)
npm run dev

# 로컬 엔진 소스 사용 (엔진 수정 시)
npm run dev:engine
```

`http://localhost:5173` 접속. 소스 파일 저장 시 브라우저 자동 리로드.
`ENGINE_PATH` 모드에서는 엔진 소스 파일 수정도 즉시 반영된다.

### MiniStats

코드에 이미 포함 (`new MiniStats(app)`). 캔버스 좌측 하단에 표시된다.

- 클릭하면 Small / Medium / Large 순환
- **DrawCall 수**, **프레임 타임**, **CPU/GPU 타임** 실시간 표시
- WebGPU에서는 렌더 패스별 GPU 타이밍 확인 가능

### 브라우저 DevTools 소스맵 디버깅

`ENGINE_PATH` 모드에서 Chrome DevTools Sources 탭을 열면 `engine/src/` 하위의 개별 소스 파일이 보인다. 아무 엔진 파일에나 브레이크포인트를 걸고 스텝 스루할 수 있다.

활용 예시:

- `src/platform/graphics/webgpu/webgpu-graphics-device.js`에 브레이크포인트 -- WebGPU 디바이스 초기화 디버깅
- `src/scene/renderer/forward-renderer.js`에 브레이크포인트 -- 렌더 루프 디버깅
- `src/scene/shader-lib/` 내부 -- 셰이더 컴파일 과정 추적

### 런타임 정보 확인

```typescript
// 콘솔에서 실시간 확인
app.on('update', () => {
    // 드로우 콜 수
    console.log('draws:', app.stats.frame.drawCalls);
    // 삼각형 수
    console.log('tris:', app.stats.frame.triangles);
    // 셰이더 컴파일 횟수
    console.log('shaders:', app.stats.frame.shaders);
});
```

### Spector.js (WebGL 프레임 캡처)

WebGPU에서는 Spector.js가 동작하지 않는다. WebGPU 프레임 디버깅에는:

- **macOS**: Xcode Metal Capture
- **Windows**: PIX
- **Chrome**: `chrome://gpu` 에서 WebGPU 상태 확인

---

## 8. 엔진 소스 수정 예시

### 예시: WebGPU 그래픽 디바이스에 커스텀 로깅 추가

```bash
# 엔진 소스 편집
code ../engine/src/platform/graphics/webgpu/webgpu-graphics-device.js
```

수정 후 저장하면 Vite가 감지하고 브라우저가 리로드된다. 빌드 단계 없이 즉시 반영.

### 예시: 셰이더 청크 수정

```bash
# WGSL 청크 편집 (WebGPU 전용이므로 WGSL만 수정)
code ../engine/src/scene/shader-lib/chunks-wgsl/lit/frag/lightDiffuseLambert.js
```

셰이더 청크는 JS 파일 안에 문자열 리터럴로 포함되어 있으므로 Vite 워치가 정상 동작한다.

### 수정 사항을 엔진에 기여하려면

```bash
cd ../engine
git checkout -b my-feature
# 수정 후
git add -A && git commit -m "feat: description"
git push origin my-feature
# GitHub에서 PR 생성
```

---

## 9. 프로덕션 빌드

```bash
npm run build
```

`dist/` 폴더에 최적화된 결과물이 생성된다:

```
dist/
├── index.html
├── assets/
│   ├── main-[hash].js          # 앱 코드
│   └── playcanvas-[hash].js    # 엔진 (별도 청크)
├── models/                      # public/에서 복사
├── textures/
└── libs/
```

**빌드 시 주의:**

- `ENGINE_PATH`를 설정하지 않으면 npm 패키지의 릴리스 빌드가 사용된다 (프로덕션에 적합)
- `ENGINE_PATH`를 설정하면 로컬 엔진 소스가 번들된다 (포크 배포 시)
- `sourcemap: true`는 디버깅용. 프로덕션에서 불필요하면 `false`로 변경

### 로컬 프리뷰

```bash
npm run preview
# http://localhost:4173 에서 빌드 결과물 확인
```

---

## 10. 배포

빌드된 `dist/` 폴더를 정적 호스팅에 업로드한다.

### Vercel

```bash
npx vercel --prod
```

### Netlify

```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist"
```

### GitHub Pages

`vite.config.ts`에 base 경로 추가:

```typescript
export default defineConfig({
    base: '/repo-name/',
    // ... 나머지 설정
});
```

```bash
npm run build
# dist/ 폴더를 gh-pages 브랜치에 푸시
npx gh-pages -d dist
```

### 자체 서버

`dist/` 폴더를 Nginx/Apache/Caddy 등으로 서빙한다. WebGPU 앱에 특별한 서버 설정은 필요 없다.

---

## 요약: 전체 워크플로

```
1. git clone engine        엔진 포크
2. mkdir my-game           게임 프로젝트 생성
3. vite.config.ts          ENGINE_PATH alias 설정
4. src/main.ts             AppBase + WebGPU + 씬 코드
5. npm run dev:engine      개발 서버 (엔진 소스 연결)
6. 브라우저 DevTools        소스맵으로 엔진 내부 디버깅
7. MiniStats               실시간 성능 오버레이
8. ../engine/src/ 수정      저장 -> 즉시 브라우저 반영
9. npm run build           프로덕션 번들
10. dist/ 배포              정적 호스팅
```
