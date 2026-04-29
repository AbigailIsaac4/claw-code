import React from 'react';
import { Typography, Tooltip, Button } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { PlanStep } from '@/utils/messageParser';

const { Text } = Typography;

interface Props {
  steps: PlanStep[];
  onExecuteStep: (fullBlock: string) => void;
}

export const PlanStepsCard: React.FC<Props> = ({ steps, onExecuteStep }) => {
  if (!steps || steps.length < 2) return null;

  return (
    <div style={{ marginTop: 12, padding: '12px 16px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
      <Text strong style={{ fontSize: 13, color: '#52c41a', display: 'block', marginBottom: 8 }}>
        📋 检测到 {steps.length} 个执行步骤，可逐步执行：
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((step) => (
          <div key={step.num} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#fff', borderRadius: 6, border: '1px solid #d9f7be' }}>
            <Text style={{ flex: 1, fontSize: 13 }}>
              <Text strong>Step {step.num}:</Text> {step.title}
            </Text>
            <Tooltip title="将此步骤填入输入框并切换到 Execute 模式">
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}
                onClick={() => onExecuteStep(step.fullBlock)}
              >
                执行
              </Button>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
};
