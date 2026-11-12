// Adapted from tutor-platform/scripts/lint/array-emptiness.ts for React/TSX.
import { AST_NODE_TYPES, ASTUtils, ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import ts from 'typescript';
const isNotEmpty = (items) => items.length > 0;
export const arrayEmptiness = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Use array predicates for emptiness checks while preserving numeric counts.'
        },
        schema: [],
        fixable: 'code',
        messages: {
            useHelper: 'Use {{helper}} for array emptiness. Handle null and undefined explicitly.'
        }
    },
    defaultOptions: [],
    create(context) {
        const services = ESLintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        const source = context.sourceCode;
        function isArray(type) {
            const constraint = checker.getBaseConstraintOfType(type);
            if (constraint && constraint !== type)
                return isArray(constraint);
            if (type.isIntersection())
                return type.types.some(isArray);
            return checker.isArrayType(type) || checker.isTupleType(type);
        }
        function arrayLength(node) {
            if (node.type === AST_NODE_TYPES.ChainExpression)
                return arrayLength(node.expression);
            if (node.type !== AST_NODE_TYPES.MemberExpression)
                return null;
            const property = node.property;
            const length = node.computed
                ? property.type === AST_NODE_TYPES.Literal && property.value === 'length'
                : property.type === AST_NODE_TYPES.Identifier && property.name === 'length';
            if (!length)
                return null;
            const type = services.getTypeAtLocation(node.object);
            const parts = type.isUnion() ? type.types : [type];
            const present = parts.filter((part) => !(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
            if (isNotEmpty(present) && present.every(isArray))
                return node;
            return null;
        }
        function booleanContext(node, strict = false) {
            const parent = node.parent;
            if (!parent)
                return false;
            if (parent.type === AST_NODE_TYPES.IfStatement ||
                parent.type === AST_NODE_TYPES.WhileStatement ||
                parent.type === AST_NODE_TYPES.DoWhileStatement ||
                parent.type === AST_NODE_TYPES.ForStatement ||
                parent.type === AST_NODE_TYPES.ConditionalExpression)
                return parent.test === node;
            if (parent.type === AST_NODE_TYPES.ChainExpression)
                return booleanContext(parent, strict);
            if (parent.type !== AST_NODE_TYPES.LogicalExpression || parent.operator === '??')
                return false;
            if (booleanContext(parent, strict))
                return true;
            if (strict)
                return false;
            // Preserve numeric fallbacks/arithmetic. Other && operands use length as a condition.
            const right = services.getTypeAtLocation(parent.right);
            const parts = right.isUnion() ? right.types : [right];
            const numeric = parts.every((part) => (part.flags & ts.TypeFlags.NumberLike) !== 0);
            return (parent.left === node &&
                ((right.flags & ts.TypeFlags.BooleanLike) !== 0 || (parent.operator === '&&' && !numeric)));
        }
        function report(node, length, helper) {
            const receiverType = services.getTypeAtLocation(length.object);
            const nullable = receiverType.isUnion() &&
                receiverType.types.some((part) => (part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0);
            const variable = ASTUtils.findVariable(source.getScope(node), helper);
            const imported = variable?.defs.some((definition) => definition.type === TSESLint.Scope.DefinitionType.ImportBinding &&
                definition.node.type === AST_NODE_TYPES.ImportSpecifier &&
                definition.parent.type === AST_NODE_TYPES.ImportDeclaration &&
                definition.node.importKind !== 'type' &&
                definition.parent.importKind !== 'type' &&
                definition.node.imported.type === AST_NODE_TYPES.Identifier &&
                definition.node.imported.name === helper &&
                /\/arrays(?:\.(?:ts|js))?$/.test(definition.parent.source.value));
            context.report({
                node,
                messageId: 'useHelper',
                data: { helper },
                // Only fix with an existing, unshadowed helper import and a non-nullable receiver.
                // Optional access needs an explicit presence decision; comments must survive untouched.
                fix: imported &&
                    !length.optional &&
                    !nullable &&
                    (node.type !== AST_NODE_TYPES.MemberExpression || booleanContext(node, true)) &&
                    !isNotEmpty(source.getCommentsInside(node))
                    ? (fixer) => fixer.replaceText(node, `${helper}(${source.getText(length.object)})`)
                    : null
            });
        }
        return {
            CallExpression(node) {
                if (node.callee.type !== AST_NODE_TYPES.Identifier || node.callee.name !== 'Boolean')
                    return;
                if (node.arguments.length !== 1)
                    return;
                const variable = ASTUtils.findVariable(source.getScope(node), 'Boolean');
                if (variable && isNotEmpty(variable.defs))
                    return;
                const argument = node.arguments[0];
                if (!argument)
                    return;
                const length = arrayLength(argument);
                if (length)
                    report(node, length, 'isNotEmpty');
            },
            BinaryExpression(node) {
                let length = arrayLength(node.left);
                let zero = node.right;
                let operator = node.operator;
                if (!length) {
                    length = arrayLength(node.right);
                    zero = node.left;
                    if (operator === '<')
                        operator = '>';
                    else if (operator === '>=')
                        operator = '<=';
                    else if (operator === '>')
                        operator = '<';
                    else if (operator === '<=')
                        operator = '>=';
                }
                if (!length || zero.type !== AST_NODE_TYPES.Literal || zero.value !== 0)
                    return;
                if (['===', '==', '<='].includes(operator))
                    report(node, length, 'isEmpty');
                if (['!==', '!=', '>'].includes(operator))
                    report(node, length, 'isNotEmpty');
            },
            UnaryExpression(node) {
                if (node.operator !== '!')
                    return;
                const length = arrayLength(node.argument);
                if (!length)
                    return;
                if (node.parent.type === AST_NODE_TYPES.UnaryExpression && node.parent.operator === '!') {
                    report(node.parent, length, 'isNotEmpty');
                }
                else
                    report(node, length, 'isEmpty');
            },
            MemberExpression(node) {
                const length = arrayLength(node);
                if (length && booleanContext(node))
                    report(node, length, 'isNotEmpty');
            }
        };
    }
};
