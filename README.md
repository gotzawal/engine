# PlayCanvas 엔진 포크 + Examples 테스트 가이드

엔진 소스를 클론하고, 빌드하고, examples 브라우저로 검증하는 전체 워크플로다.

---

## 1. 엔진 소스 받기

환경에 nvm과 Node.js가 설치되어 있어야 한다.

```bash
mkdir workspace && cd workspace

# 전체 히스토리가 필요 없으면 --depth 1 (속도 빠름)
git clone --depth 1 https://github.com/playcanvas/engine.git

cd engine
npm install
```

포크해서 자기 저장소로 관리하려면:

```bash
# GitHub에서 playcanvas/engine 포크 후
git clone https://github.com/<내-계정>/engine.git
cd engine
git remote add upstream https://github.com/playcanvas/engine.git
npm install
```

---

## 2. 엔진 빌드

```bash
npm run build
```

`build/` 디렉토리에 산출물이 생긴다:

```
build/
├── playcanvas.mjs          # 릴리스 ESM 번들
├── playcanvas.dbg.mjs      # 디버그 (assert, 상세 에러)
├── playcanvas.prf.mjs      # 프로파일러 (성능 계측)
├── playcanvas.d.ts          # TypeScript 선언
└── playcanvas/
    └── src/index.js         # 릴리스 (모듈별 소스 구조 유지)
```

빌드가 에러 없이 끝나면 엔진 소스에 문법 오류가 없다는 첫 번째 확인이다.

---

## 3. 유닛 테스트

빌드 직후 바로 돌린다.

```bash
npm test
```

특정 영역만 테스트:

```bash
npm test -- --grep "GraphicsDevice"
npm test -- --grep "Texture"
npm test -- --grep "StandardMaterial"
```

유닛 테스트는 headless(NullGraphicsDevice)에서 돌아가므로 실제 렌더링은 검증하지 않는다. API 계약과 로직만 확인한다. 렌더링 결과는 examples로 확인해야 한다.

---

## 4. examples 세팅

examples는 엔진과 별도의 npm 프로젝트다. 자체 의존성을 설치해야 한다.

```bash
cd examples
npm install
```

이 시점의 디렉토리 구조:

```
workspace/
└── engine/
    ├── src/              # 엔진 소스 (수정 대상)
    ├── build/            # 빌드 산출물
    ├── examples/         # 독립 서브 프로젝트
    │   ├── package.json  # 자체 의존성
    │   ├── src/examples/ # .example.mjs 파일들 (100+)
    │   └── assets/       # 데모용 모델, 텍스처, WASM
    └── tests/            # 유닛 테스트
```

---

## 5. examples 브라우저 실행

### 기본 실행

```bash
cd engine/examples
npm run develop
```

`http://localhost:5000` 접속. 좌측 사이드바에서 카테고리별 examples를 선택한다.

### 디버그 빌드로 실행 (권장)

assert 실패와 상세 에러 메시지가 콘솔에 출력된다. 엔진 수정 후 문제를 찾으려면 이쪽이 낫다.

```bash
ENGINE_PATH=../build/playcanvas.dbg.mjs npm run develop
```

---

## 6. WebGPU 모드로 테스트


**URL 파라미터:**
```
http://localhost:5555/
```


---

## 7. WebGPU 스모크 테스트 5종

엔진을 처음 빌드했거나 수정한 뒤, 이 5개만 돌리면 WebGPU 핵심 경로를 전부 커버한다.

```
graphics/material-physical?deviceType=webgpu      PBR 파이프라인
light/clustered-lighting?deviceType=webgpu        클러스터드 라이팅
post-effects/bloom?deviceType=webgpu              포스트프로세싱
compute/compute-particles?deviceType=webgpu       컴퓨트 셰이더
loaders/loader-gltf?deviceType=webgpu             에셋 로딩
```

각 example에서 확인:
- 화면에 렌더링이 나오는가
- DevTools Console에 에러가 없는가
- MiniStats가 합리적인 FPS를 표시하는가

5개 모두 정상이면 WebGPU 백엔드 기본 동작은 검증된 것이다.

---

## 8. 엔진 수정 -> 자동 리빌드 -> 테스트 루프

터미널 2개를 쓴다.

```bash
# 터미널 1 -- 엔진 소스 변경 감지, 자동 리빌드
cd engine
npm run watch:debug

# 터미널 2 -- examples 서버
cd engine/examples
ENGINE_PATH=../build/playcanvas.dbg.mjs npm run develop
```

흐름:

```
엔진 소스 수정 (src/ 아래 아무 파일)
     |
watch:debug가 감지 -> build/ 자동 갱신 (~3-5초)
     |
브라우저에서 example 새로고침 (F5)
     |
수정된 엔진으로 실행
```

---

## 9. 수정 영역별 확인할 examples

```
examples/src/examples/
├── animation/         # Anim 컴포넌트, 블렌드 트리
├── camera/            # 카메라 컨트롤
├── compute/           # 컴퓨트 셰이더 (WebGPU 전용)
├── graphics/          # 머티리얼, 라이팅, 셰이더, 인스턴싱
├── input/             # 키보드, 마우스, 터치
├── light/             # 라이트 타입, 쉐도우, 클러스터드
├── loaders/           # glTF, Draco, Basis
├── physics/           # Ammo.js
├── post-effects/      # CameraFrame (블룸, SSAO, TAA)
└── ...
```

| 수정한 곳 | 테스트할 examples |
|---|---|
| `src/platform/graphics/webgpu/` | `graphics/` 전체, `compute/` 전체 |
| `src/scene/shader-lib/chunks-wgsl/` | `graphics/material-*`, `light/` 전체 |
| `src/scene/renderer/` | `graphics/`, `light/`, `post-effects/` |
| `src/scene/lighting/` | `light/clustered-*`, `light/shadows` |
| `src/extras/camera-frame/` | `post-effects/` 전체 |
| `src/framework/handlers/` | `loaders/` 전체 |
| `src/platform/input/` | `input/` 전체 |
| `src/framework/anim/` | `animation/` 전체 |

---

## 10. 비주얼 비교와 성능 확인

### 수정 전후 스크린샷 비교

```
1. 수정 전: example 열고 DevTools > Ctrl+Shift+P > "Capture screenshot"
2. 엔진 수정
3. 리빌드 후 같은 example에서 다시 스크린샷
4. 두 이미지 비교
```

### MiniStats 성능 비교

examples 브라우저에서 MiniStats가 자동 표시된다. 수정 전후 같은 example에서:

- **DrawCall 수** -- 증가했으면 렌더 최적화 회귀
- **프레임 타임** -- 증가했으면 성능 회귀
- **GPU 타임** -- WebGPU에서 패스별 시간 확인

### 콘솔 에러

디버그 빌드에서 example을 열 때마다 DevTools Console을 확인한다. 새로운 경고/에러가 생겼으면 수정에 문제가 있다.

---

## 11. 게임 프로젝트에서 최종 검증

examples 확인이 끝나면 실제 게임 프로젝트에서 최종 테스트한다.

```bash
cd workspace/my-game
ENGINE_PATH=../engine npm run dev
```

확인:
- 기존 씬이 깨지지 않는지
- 콘솔에 새로운 에러가 없는지
- MiniStats 수치가 이전과 비슷한지

---

## 전체 워크플로 요약

```
git clone engine              소스 받기
npm install                   의존성 설치
npm run build                 빌드 (문법 오류 확인)
npm test                      유닛 테스트
cd examples && npm install    examples 세팅
npm run develop               examples 브라우저 실행
  +-- WebGPU 스모크 테스트 5종
  +-- 콘솔 에러 확인
       |
엔진 소스 수정 (터미널 1: watch:debug)
       |
examples 새로고침으로 확인
  +-- 수정 영역 관련 examples
  +-- 콘솔 에러
  +-- MiniStats 성능
       |
게임 프로젝트에서 최종 검증
       |
git commit + PR
```
