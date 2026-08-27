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
      "id": "wholebody",
      "label": "Whole Body (v1.3)",
      "modelAssets": [
        {
          "id": "musclemap-wholebody",
          "filename": "musclemap-wholebody.onnx",
          "numClasses": 100,
          "roiSize": [
            256,
            256
          ],
          "modelVersion": "1.3",
          "labelSpaceId": "musclemap-wholebody-v1.3",
          "legacy": false,
          "revision": "a8cdbf8c2874e1a2f617ecc6695244a0810eac11",
          "url": "https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/a8cdbf8c2874e1a2f617ecc6695244a0810eac11/musclemap/musclemap-wholebody.onnx",
          "bytes": 26888722,
          "sha256": "3bff6e22e54d3d7399247d5e71d6423c91bb636d86ab21e0dd929524afbc2bc7"
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
          "sha256": "f2e64dd67104422f94c29382136aa438835aaea7aadc91a917178732cfc15d41"
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
          "sha256": "48517f2aadc19183025dfe1a1952c24ae79d9a33fa5dd8154b46cf47fd87d3dd"
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
          "sha256": "3ad1c902998849ea66942863d157e1f8e608fb2c9d6b3230ee56de0e0840bcb4"
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
          "sha256": "34babe3b30a587dc4f67f44da44a6f89f7f66dcd2d128351ecf9356cbc0c32e4"
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
          "sha256": "2d1a607adfa0758516069e039717079a2340811e3d3c70a7e9621aa1564399f2"
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
