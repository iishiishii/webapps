import { definePlugin } from '../plugin.js';

export const musclemapPlugin = definePlugin({
  "id": "musclemap",
  "name": "MuscleMap",
  "description": "MuscleMap model family metadata and metrics/legend UI hooks.",
  "sourceRepos": [
    "MuscleMap/MuscleMap",
    "neurodesk/musclemap-webapp"
  ],
  "capabilities": [
    "onnx-segmentation",
    "multi-label-metrics",
    "label-legend"
  ],
  "tasks": [
    {
      "id": "wholebody-v1.3",
      "label": "Whole Body (Legacy v1.3)",
      "modelAssets": [
        {
          "id": "musclemap-wholebody-v1.3",
          "filename": "musclemap-wholebody.onnx",
          "numClasses": 100,
          "roiSize": [
            256,
            256
          ],
          "modelVersion": "1.3",
          "labelSpaceId": "musclemap-wholebody-v1.3",
          "legacy": true,
          "revision": "a8cdbf8c2874e1a2f617ecc6695244a0810eac11",
          "url": "https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/a8cdbf8c2874e1a2f617ecc6695244a0810eac11/musclemap/musclemap-wholebody.onnx",
          "bytes": 26888722,
          "sha256": "3bff6e22e54d3d7399247d5e71d6423c91bb636d86ab21e0dd929524afbc2bc7",
          "parts": null
        }
      ]
    },
    {
      "id": "wholebody",
      "label": "Whole Body (v1.4)",
      "modelAssets": [
        {
          "id": "musclemap-wholebody",
          "filename": "musclemap-wholebody.onnx",
          "numClasses": 114,
          "roiSize": [
            256,
            256
          ],
          "modelVersion": "1.4",
          "labelSpaceId": "musclemap-wholebody-v1.4",
          "legacy": false,
          "revision": "6380bd2487eeb47bdc59d63eef69fb0241bd1197",
          "url": "https://github.com/neurodesk/webapps/releases/download/musclemap-model-v1.4-fp32/musclemap-wholebody-v1.4-fp32.onnx",
          "bytes": 104946960,
          "sha256": "6380bd2487eeb47bdc59d63eef69fb0241bd11976712677ccee329f83552a1e6",
          "parts": [
            {
              "path": "models/musclemap-wholebody-v1.4-fp32.part-00",
              "bytes": 21000000,
              "sha256": "15a325c63285f00661dfabb58e924958ac9fd33b76868e0431988567c4b49781"
            },
            {
              "path": "models/musclemap-wholebody-v1.4-fp32.part-01",
              "bytes": 21000000,
              "sha256": "1428e9754815bf1bf0fe269578e44788be5f6cffa3f110d880f7d05ca918db6a"
            },
            {
              "path": "models/musclemap-wholebody-v1.4-fp32.part-02",
              "bytes": 21000000,
              "sha256": "4846fac49ecb36749b1ad937752d3ccf46c3a7ea48f4ebca4a1b4c71071b3e48"
            },
            {
              "path": "models/musclemap-wholebody-v1.4-fp32.part-03",
              "bytes": 21000000,
              "sha256": "63246bd7ae1711fc560ae368a5ec07a168c6ca18c32ce1c62aa1193483fd9feb"
            },
            {
              "path": "models/musclemap-wholebody-v1.4-fp32.part-04",
              "bytes": 20946960,
              "sha256": "899040852445f7082e4198aafabb20380ed9f2b54e77533500a64ed39b04906d"
            }
          ]
        }
      ]
    },
    {
      "id": "abdomen",
      "label": "Abdomen (Legacy v0.0)",
      "modelAssets": [
        {
          "id": "musclemap-abdomen",
          "filename": "musclemap-abdomen.onnx",
          "numClasses": 9,
          "roiSize": [
            128,
            128
          ],
          "modelVersion": "0.0",
          "labelSpaceId": "musclemap-abdomen-v0.0",
          "legacy": true,
          "revision": "a8cdbf8c2874e1a2f617ecc6695244a0810eac11",
          "url": "https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/a8cdbf8c2874e1a2f617ecc6695244a0810eac11/musclemap/musclemap-abdomen.onnx",
          "bytes": 38999828,
          "sha256": "f2e64dd67104422f94c29382136aa438835aaea7aadc91a917178732cfc15d41",
          "parts": null
        }
      ]
    },
    {
      "id": "forearm",
      "label": "Forearm (Legacy v0.0)",
      "modelAssets": [
        {
          "id": "musclemap-forearm",
          "filename": "musclemap-forearm.onnx",
          "numClasses": 6,
          "roiSize": [
            256,
            256
          ],
          "modelVersion": "0.0",
          "labelSpaceId": "musclemap-forearm-v0.0",
          "legacy": true,
          "revision": "a8cdbf8c2874e1a2f617ecc6695244a0810eac11",
          "url": "https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/a8cdbf8c2874e1a2f617ecc6695244a0810eac11/musclemap/musclemap-forearm.onnx",
          "bytes": 26364376,
          "sha256": "48517f2aadc19183025dfe1a1952c24ae79d9a33fa5dd8154b46cf47fd87d3dd",
          "parts": null
        }
      ]
    },
    {
      "id": "leg",
      "label": "Leg (Legacy v0.0)",
      "modelAssets": [
        {
          "id": "musclemap-leg",
          "filename": "musclemap-leg.onnx",
          "numClasses": 15,
          "roiSize": [
            128,
            128
          ],
          "modelVersion": "0.0",
          "labelSpaceId": "musclemap-leg-v0.0",
          "legacy": true,
          "revision": "a8cdbf8c2874e1a2f617ecc6695244a0810eac11",
          "url": "https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/a8cdbf8c2874e1a2f617ecc6695244a0810eac11/musclemap/musclemap-leg.onnx",
          "bytes": 39028867,
          "sha256": "3ad1c902998849ea66942863d157e1f8e608fb2c9d6b3230ee56de0e0840bcb4",
          "parts": null
        }
      ]
    },
    {
      "id": "pelvis",
      "label": "Pelvis (Legacy v0.0)",
      "modelAssets": [
        {
          "id": "musclemap-pelvis",
          "filename": "musclemap-pelvis.onnx",
          "numClasses": 14,
          "roiSize": [
            128,
            128
          ],
          "modelVersion": "0.0",
          "labelSpaceId": "musclemap-pelvis-v0.0",
          "legacy": true,
          "revision": "a8cdbf8c2874e1a2f617ecc6695244a0810eac11",
          "url": "https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/a8cdbf8c2874e1a2f617ecc6695244a0810eac11/musclemap/musclemap-pelvis.onnx",
          "bytes": 39023986,
          "sha256": "34babe3b30a587dc4f67f44da44a6f89f7f66dcd2d128351ecf9356cbc0c32e4",
          "parts": null
        }
      ]
    },
    {
      "id": "thigh",
      "label": "Thigh (Legacy v0.0)",
      "modelAssets": [
        {
          "id": "musclemap-thigh",
          "filename": "musclemap-thigh.onnx",
          "numClasses": 29,
          "roiSize": [
            128,
            128
          ],
          "modelVersion": "0.0",
          "labelSpaceId": "musclemap-thigh-v0.0",
          "legacy": true,
          "revision": "a8cdbf8c2874e1a2f617ecc6695244a0810eac11",
          "url": "https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/a8cdbf8c2874e1a2f617ecc6695244a0810eac11/musclemap/musclemap-thigh.onnx",
          "bytes": 39099153,
          "sha256": "2d1a607adfa0758516069e039717079a2340811e3d3c70a7e9621aa1564399f2",
          "parts": null
        }
      ]
    }
  ],
  "workerSteps": {
    "run": {
      "requestType": "run",
      "outputStages": [
        "segmentation"
      ],
      "events": [
        "detectedLabels",
        "metrics"
      ]
    }
  }
});

export const muscleMapPlugin = musclemapPlugin;
